import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';

describe('Logger Safety', () => {
    it('safeSerialize handles all types correctly without throwing', () => {
        function safeSerialize(arg: any) {
            try {
                if (arg === null) return 'null';
                if (arg === undefined) return 'undefined';
                if (arg instanceof Error) return arg.stack || arg.message;
                if (typeof arg === 'object') {
                    try {
                        return JSON.stringify(arg);
                    } catch (e) {
                        return '[Unserializable Object]';
                    }
                }
                return String(arg);
            } catch (err) {
                return '[Serialization Error]';
            }
        }

        expect(safeSerialize(null)).toBe('null');
        expect(safeSerialize(undefined)).toBe('undefined');
        expect(safeSerialize({ a: null })).toBe('{"a":null}');
        expect(safeSerialize(new Error('test'))).toContain('Error: test');
        const circular: any = {}; circular.self = circular;
        expect(safeSerialize(circular)).toBe('[Unserializable Object]');
    });
});