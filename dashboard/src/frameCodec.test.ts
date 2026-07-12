import { describe, expect, it } from 'vitest';
import { decode2BitCells, encode2BitCells } from './frameCodec';

describe('2-bit frame codec', () => {
  it('round trips all four cell states', () => {
    const cells = [0, 1, 2, 3, 3, 2, 1, 0, 2];
    expect(Array.from(decode2BitCells(encode2BitCells(cells), cells.length))).toEqual(cells);
  });
  it('rejects invalid state values', () => expect(() => encode2BitCells([4])).toThrow('Invalid cell state'));
});
