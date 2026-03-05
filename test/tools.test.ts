import { describe, it, expect } from 'vitest';
import { stripSensitive } from '../src/tools.js';

describe('stripSensitive', () => {
  it('strips path from tcp addresses', () => {
    expect(stripSensitive('localhost:5432/mydb')).toBe('localhost:5432');
  });

  it('strips credentials from URLs', () => {
    expect(stripSensitive('http://user:pass@host:5432/db')).toBe('host:5432');
  });

  it('strips query strings', () => {
    expect(stripSensitive('localhost:3000?token=secret')).toBe('localhost:3000');
  });

  it('keeps plain host:port', () => {
    expect(stripSensitive('redis:6379')).toBe('redis:6379');
  });

  it('handles HTTP URLs', () => {
    expect(stripSensitive('http://api.internal:8080/v1/users')).toBe('api.internal:8080');
  });

  it('handles bare hostnames', () => {
    expect(stripSensitive('postgres')).toBe('postgres');
  });

  // ── Edge Cases ──

  it('handles HTTPS URLs', () => {
    expect(stripSensitive('https://api.example.com/v1/users')).toBe('api.example.com');
  });

  it('handles URL with port and path', () => {
    expect(stripSensitive('https://api.example.com:8443/health')).toBe('api.example.com:8443');
  });

  it('handles IPv4 addresses', () => {
    expect(stripSensitive('192.168.1.1:3306')).toBe('192.168.1.1:3306');
  });

  it('handles URL with fragment', () => {
    expect(stripSensitive('http://example.com:8080/path#section')).toBe('example.com:8080');
  });

  it('strips user@ without password', () => {
    expect(stripSensitive('http://admin@host:5432/db')).toBe('host:5432');
  });

  it('handles empty port in URL', () => {
    expect(stripSensitive('http://example.com')).toBe('example.com');
  });

  it('handles hostname with dots', () => {
    expect(stripSensitive('my.internal.service:9090')).toBe('my.internal.service:9090');
  });

  it('handles host:port with trailing slash', () => {
    expect(stripSensitive('localhost:3000/')).toBe('localhost:3000');
  });
});
