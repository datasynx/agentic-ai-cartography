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
});
