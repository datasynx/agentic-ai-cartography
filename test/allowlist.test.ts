import { describe, it, expect } from 'vitest';
import { checkReadOnly, isReadOnlyCommand, assertReadOnly, splitSegments } from '../src/allowlist.js';

// Real command strings the scanners actually run (from tools.ts / platform.ts).
const REAL_READONLY_COMMANDS = [
  'psql -lqt',
  'psql -lqt 2>/dev/null | grep -v "template0\\|template1" | awk \'{print $1}\' | grep -v "^$\\|^|"',
  'pg_lsclusters 2>/dev/null',
  'mysql --connect-timeout=3 -e "SHOW DATABASES;" 2>/dev/null',
  'redis-cli info server 2>/dev/null | head -5',
  'find "/home/user" -maxdepth 6 \\( -name "*.sqlite" -o -name "*.db" \\) -not -path "*/node_modules/*" 2>/dev/null | head -100',
  'kubectl config current-context 2>/dev/null || echo "(no context set)"',
  'kubectl get nodes -o wide',
  'kubectl get services --all-namespaces',
  'kubectl get pods --all-namespaces --field-selector=status.phase=Running 2>/dev/null | head -60',
  'aws sts get-caller-identity --profile prod --output json',
  'aws ec2 describe-instances --query "Reservations[*]" --output table',
  'aws rds describe-db-instances --output table',
  'aws s3 ls',
  'aws ec2 describe-vpcs --query "Vpcs[*]" --output table',
  'gcloud config list account --format="value(core.account)"',
  'gcloud compute instances list --project my-proj',
  'gcloud container clusters list',
  'az account show --output json',
  'az vm list --output table',
  'az aks list --resource-group rg --output table',
  'ls /Applications/ 2>/dev/null | head -200',
  'brew list --cask 2>/dev/null | head -100',
  'mdfind "kMDItemKind == \'Application\'" 2>/dev/null | grep -v "^/System" | head -100',
  'dpkg --list 2>/dev/null | awk \'{print $2}\' | head -200',
  'snap list 2>/dev/null | head -50',
  'flatpak list 2>/dev/null | head -50',
  'rpm -qa 2>/dev/null | head -200',
  'ls /usr/share/applications/*.desktop 2>/dev/null | xargs -I{} basename {} .desktop 2>/dev/null | head -100',
  'ss -tlnp',
  'ps aux',
  'lsof -iTCP -sTCP:LISTEN -n -P',
  'docker inspect my-container',
  'docker ps',
  'curl -s https://example.com',
  // PowerShell
  'Get-NetTCPConnection -State Listen',
  'Get-Process',
  'Get-ChildItem -Path C:\\ -Recurse | Where-Object { $_.Name -match "x" } | Select-Object -First 5',
];

const MUST_BLOCK = [
  'rm -rf /',
  'rm -rf ~/data',
  'mv a b',
  'dd if=/dev/zero of=/dev/sda',
  'kubectl delete pod x',
  'kubectl apply -f manifest.yaml',
  'kubectl exec -it pod -- sh',
  'docker run -it ubuntu',
  'docker rm -f c',
  'docker exec c sh',
  'aws ec2 terminate-instances --instance-ids i-123',
  'aws s3 rm s3://bucket/key',
  'gcloud compute instances delete my-vm',
  'az vm delete --name v',
  'brew install wget',
  'npm install left-pad',
  'apt-get install nginx',
  'dpkg -r somepackage',
  'rpm -e somepackage',
  'snap remove foo',
  'curl -X POST https://api.example.com',
  'curl https://x.com -o /etc/passwd',
  'wget -O /tmp/x https://x.com',
  'echo hacked > /etc/passwd',
  'cat /etc/passwd >> /tmp/leak',
  'ls | xargs rm',
  'find . -name "*.log" -delete',
  'find . -exec rm {} \\;',
  'awk \'BEGIN{system("rm -rf /")}\'',
  'true; rm -rf /',
  'ls && shutdown now',
  'echo $(rm -rf /)',
  'cat `whoami`',
  'Stop-Computer',
  'Remove-Item -Recurse C:\\data',
  'Set-Content -Path x -Value y',
  'systemctl stop nginx',
  'kill -9 1234',
];

describe('read-only allowlist', () => {
  it('allows every real scanner command', () => {
    for (const cmd of REAL_READONLY_COMMANDS) {
      const r = checkReadOnly(cmd);
      expect(r.allowed, `expected ALLOWED: ${cmd} → ${r.reason ?? ''}`).toBe(true);
    }
  });

  it('blocks every mutating / dangerous command', () => {
    for (const cmd of MUST_BLOCK) {
      expect(isReadOnlyCommand(cmd), `expected BLOCKED: ${cmd}`).toBe(false);
    }
  });

  it('rejects empty and substitution commands', () => {
    expect(checkReadOnly('').allowed).toBe(false);
    expect(checkReadOnly('   ').allowed).toBe(false);
    expect(checkReadOnly('echo $(id)').allowed).toBe(false);
    expect(checkReadOnly('echo `id`').allowed).toBe(false);
  });

  it('splitSegments respects quotes', () => {
    expect(splitSegments('grep -v "a|b" file | head')).toEqual(['grep -v "a|b" file', 'head']);
    expect(splitSegments('a && b || c ; d')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('assertReadOnly throws on blocked commands', () => {
    expect(() => assertReadOnly('rm -rf /')).toThrow(/read-only allowlist/);
    expect(() => assertReadOnly('ls')).not.toThrow();
  });

  it('allows platform.ts internal constructs (brace groups, sudo lsof)', () => {
    expect(isReadOnlyCommand('{ find "/a" -maxdepth 4 \\( -name "*.db" \\) 2>/dev/null; find "/b" -maxdepth 4 \\( -name "*.db" \\) 2>/dev/null; } | head -80')).toBe(true);
    expect(isReadOnlyCommand('sudo lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null || lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null')).toBe(true);
    expect(isReadOnlyCommand('which docker 2>/dev/null')).toBe(true);
    // sudo must still reject a mutating inner command
    expect(isReadOnlyCommand('sudo rm -rf /')).toBe(false);
  });

  describe('PowerShell mode', () => {
    const ps = (cmd: string) => checkReadOnly(cmd, { shell: 'powershell' });
    it('allows read-only cmdlets with subexpressions and pipelines', () => {
      expect(ps('Get-Process | Select-Object Id, ProcessName | Format-Table -AutoSize | Out-String -Width 200').allowed).toBe(true);
      expect(ps('Get-NetTCPConnection -State Listen | ForEach-Object { $p = Get-Process -Id $_.OwningProcess; "$($_.LocalPort) $($p.ProcessName)" } | Sort-Object -Unique').allowed).toBe(true);
      expect(ps('Get-Service | Where-Object { $_.Name -match "postgres|mysql" } | Select-Object Name, Status').allowed).toBe(true);
      expect(ps('Get-ChildItem -Path C:\\ -Recurse -Depth 4 -ErrorAction SilentlyContinue | Select-Object -First 20 -ExpandProperty FullName').allowed).toBe(true);
    });
    it('blocks mutating cmdlets and writes', () => {
      expect(ps('Remove-Item C:\\data -Recurse').allowed).toBe(false);
      expect(ps('Stop-Process -Id 1234').allowed).toBe(false);
      expect(ps('Set-Content -Path x -Value y').allowed).toBe(false);
      expect(ps('Get-Process > C:\\out.txt').allowed).toBe(false);
      expect(ps('Invoke-WebRequest -Method POST http://x').allowed).toBe(false);
    });
  });
});
