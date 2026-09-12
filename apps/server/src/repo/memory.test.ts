import { describe, expect, test } from 'vitest';
import { createMemoryRepositories } from './memory';

describe('transaction id sequence', () => {
  test('issues increasing ids', async () => {
    // Arrange
    const repos = createMemoryRepositories();

    // Act
    const first = await repos.sessions.nextTransactionId();
    const second = await repos.sessions.nextTransactionId();

    // Assert
    expect(second).toBeGreaterThan(first);
  });

  test('never reissues an id the stored record already holds', async () => {
    // Arrange: a fresh process starting against a database that has seen 4210 transactions.
    const repos = createMemoryRepositories();
    await repos.sessions.resumeTransactionIds(4210);

    // Act
    const next = await repos.sessions.nextTransactionId();

    // Assert
    expect(next).toBeGreaterThan(4210);
  });

  test('ignores a resume point below where the sequence already is', async () => {
    // Arrange
    const repos = createMemoryRepositories();
    await repos.sessions.resumeTransactionIds(5000);
    await repos.sessions.nextTransactionId();

    // Act: a stale or lower reading must not wind the sequence back.
    await repos.sessions.resumeTransactionIds(12);
    const next = await repos.sessions.nextTransactionId();

    // Assert
    expect(next).toBeGreaterThan(5001);
  });

  test('ignores a resume point that is not a number', async () => {
    // Arrange
    const repos = createMemoryRepositories();
    const before = await repos.sessions.nextTransactionId();

    // Act
    await repos.sessions.resumeTransactionIds(Number.NaN);
    const after = await repos.sessions.nextTransactionId();

    // Assert
    expect(after).toBe(before + 1);
  });
});
