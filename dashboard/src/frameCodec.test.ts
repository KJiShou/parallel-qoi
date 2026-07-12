import { describe, expect, it } from 'vitest';
import { bitMaskHasAny, decode2BitCells, decodeBitMask, encode2BitCells } from './frameCodec';

describe('2-bit frame codec', () => {
  it('round trips all four cell states', () => { const cells = [0, 1, 2, 3, 3, 2, 1, 0, 2]; expect(Array.from(decode2BitCells(encode2BitCells(cells), cells.length))).toEqual(cells); });
  it('rejects invalid state values', () => expect(() => encode2BitCells([4])).toThrow('Invalid cell state'));
});
describe('burning bit mask', () => {
  it('decodes little-bit-order flags', () => expect(Array.from(decodeBitMask(btoa(String.fromCharCode(0b00000101)), 8))).toEqual([1,0,1,0,0,0,0,0]));
  it('detects any set packed bit without expanding the mask', () => { expect(bitMaskHasAny(btoa(String.fromCharCode(0)),8)).toBe(false); expect(bitMaskHasAny(btoa(String.fromCharCode(0b10000000)),8)).toBe(true); });
  it('rejects the wrong packed length', () => expect(() => decodeBitMask('', 8)).toThrow('Burning mask length mismatch'));
});
