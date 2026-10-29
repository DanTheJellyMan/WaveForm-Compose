interface NumberWrapperInterface {
    readonly value: number | bigint;
}

interface NumberWrapperConstructor<
    T extends NumberWrapperInterface = NumberWrapperInterface
> {
    readonly BYTES: number;
    readonly FLOAT: boolean;
    readonly MIN: number | bigint;
    readonly MAX: number | bigint;

    new (value: number | bigint): T;

    normalizeValue(value: number | bigint): number | bigint;
}

interface IntegerWrapperConstructor extends NumberWrapperConstructor {
    readonly FLOAT: false;
}
interface UnsignedIntegerWrapperConstructor extends IntegerWrapperConstructor {
    readonly MIN: 0 | 0n;
}


interface FloatWrapperConstructor extends NumberWrapperConstructor {
    readonly FLOAT: true;
    readonly MIN: number;
    readonly MAX: number;
}

/**
 * Only necessary when generically creating number wrappers
 * @param constructor 
 * @param value 
 * @returns 
 */
export default function createWrapper<
    T extends NumberWrapperInterface
>(constructor: NumberWrapperConstructor<T>, value: number): T {
    return new constructor(value);
}



export class Int8 implements NumberWrapperInterface {
    public static readonly BYTES = 1;
    public static readonly FLOAT = false;
    public static readonly MIN = (-2) ** (Int8.BYTES*8 - 1);
    public static readonly MAX = (2 ** (Int8.BYTES*8 - 1)) - 1;

    private __value: number;

    constructor(value: number | bigint) {
        this.__value = Int8.normalizeValue(Number(value));
    }

    set value(newValue: number) {
        this.__value = Int8.normalizeValue(newValue);
    }
    get value(): number {
        return this.__value;
    }

    public static normalizeValue(value: number): number {
        return Math.min(Math.max(Int8.MIN, value), Int8.MAX);
    }
}
interface Int8Constructor extends IntegerWrapperConstructor {
    readonly BYTES: 1;
    readonly MIN: number;
    readonly MAX: number;
}
export const Int8Type = Int8 satisfies Int8Constructor;

export class Int16 implements NumberWrapperInterface {
    public static readonly BYTES = 2;
    public static readonly FLOAT = false;
    public static readonly MIN = (-2) ** (Int16.BYTES*8 - 1);
    public static readonly MAX = (2 ** (Int16.BYTES*8 - 1)) - 1;

    private __value: number;

    constructor(value: number | bigint) {
        this.__value = Int16.normalizeValue(Number(value));
    }

    set value(newValue: number) {
        this.__value = Int16.normalizeValue(newValue);
    }
    get value(): number {
        return this.__value;
    }

    public static normalizeValue(value: number): number {
        return Math.min(Math.max(Int16.MIN, value), Int16.MAX);
    }
}
interface Int16Constructor extends IntegerWrapperConstructor {
    readonly BYTES: 2;
    readonly MIN: number;
    readonly MAX: number;
}
export const Int16Type = Int16 satisfies Int16Constructor;

export class Int32 implements NumberWrapperInterface {
    public static readonly BYTES = 4;
    public static readonly FLOAT = false;
    public static readonly MIN = (-2) ** (Int32.BYTES*8 - 1);
    public static readonly MAX = (2 ** (Int32.BYTES*8 - 1)) - 1;

    private __value: number;

    constructor(value: number | bigint) {
        this.__value = Int32.normalizeValue(Number(value));
    }

    set value(newValue: number) {
        this.__value = Int32.normalizeValue(newValue);
    }
    get value(): number {
        return this.__value;
    }

    public static normalizeValue(value: number): number {
        return Math.min(Math.max(Int32.MIN, value), Int32.MAX);
    }
}
interface Int32Constructor extends IntegerWrapperConstructor {
    readonly BYTES: 4;
    readonly MIN: number;
    readonly MAX: number;
}
export const Int32Type = Int32 satisfies Int32Constructor;

export class Int64 implements NumberWrapperInterface {
    public static readonly BYTES = 8;
    public static readonly FLOAT = false;
    public static readonly MIN = (-2n) ** (BigInt(Int64.BYTES*8 - 1));
    public static readonly MAX = (2n ** BigInt(Int64.BYTES*8 - 1)) - 1n;

    private __value: bigint;

    constructor(value: number | bigint) {
        this.__value = Int64.normalizeValue(BigInt(value));
    }

    set value(newValue: bigint) {
        this.__value = Int64.normalizeValue(newValue);
    }
    get value(): bigint {
        return this.__value;
    }

    public static normalizeValue(value: bigint): bigint {
        value = Int64.MIN > value ? Int64.MIN : value;
        value = Int64.MAX < value ? Int64.MAX : value;
        return value;
    }
}
interface Int64Constructor extends IntegerWrapperConstructor {
    readonly BYTES: 8;
    readonly MIN: bigint;
    readonly MAX: bigint;
}
export const Int64Type = Int64 satisfies Int64Constructor;

export class Uint8 implements NumberWrapperInterface {
    public static readonly BYTES = 1;
    public static readonly FLOAT = false;
    public static readonly MIN = 0;
    public static readonly MAX = (2 ** (Uint8.BYTES*8)) - 1;

    private __value: number;

    constructor(value: number | bigint) {
        this.__value = Uint8.normalizeValue(Number(value));
    }

    set value(newValue: number) {
        this.__value = Uint8.normalizeValue(newValue);
    }
    get value(): number {
        return this.__value;
    }

    public static normalizeValue(value: number): number {
        return Math.min(Math.max(Uint8.MIN, value), Uint8.MAX);
    }
}
interface Uint8Constructor extends UnsignedIntegerWrapperConstructor {
    readonly BYTES: 1;
    readonly MAX: number;
}
export const Uint8Type = Uint8 satisfies Uint8Constructor;

export class Uint16 implements NumberWrapperInterface {
    public static readonly BYTES = 2;
    public static readonly FLOAT = false;
    public static readonly MIN = 0;
    public static readonly MAX = (2 ** (Uint16.BYTES*8)) - 1;

    private __value: number;

    constructor(value: number | bigint) {
        this.__value = Uint16.normalizeValue(Number(value));
    }

    set value(newValue: number) {
        this.__value = Uint16.normalizeValue(newValue);
    }
    get value(): number {
        return this.__value;
    }

    public static normalizeValue(value: number): number {
        return Math.min(Math.max(Uint16.MIN, value), Uint16.MAX);
    }
}
interface Uint16Constructor extends UnsignedIntegerWrapperConstructor {
    readonly BYTES: 2;
    readonly MAX: number;
}
export const Uint16Type = Uint16 satisfies Uint16Constructor;

export class Uint32 implements NumberWrapperInterface {
    public static readonly BYTES = 4;
    public static readonly FLOAT = false;
    public static readonly MIN = 0;
    public static readonly MAX = (2 ** (Uint32.BYTES*8)) - 1;

    private __value: number;

    constructor(value: number | bigint) {
        this.__value = Uint32.normalizeValue(Number(value));
    }

    set value(newValue: number) {
        this.__value = Uint32.normalizeValue(newValue);
    }
    get value(): number {
        return this.__value;
    }

    public static normalizeValue(value: number): number {
        return Math.min(Math.max(Uint32.MIN, value), Uint32.MAX);
    }
}
interface Uint32Constructor extends UnsignedIntegerWrapperConstructor {
    readonly BYTES: 4;
    readonly MAX: number;
}
export const Uint32Type = Uint32 satisfies Uint32Constructor;

export class Uint64 implements NumberWrapperInterface {
    public static readonly BYTES = 8;
    public static readonly FLOAT = false;
    public static readonly MIN = 0n;
    public static readonly MAX = (2n ** BigInt(Uint64.BYTES*8)) - 1n;

    private __value: bigint;

    constructor(value: number | bigint) {
        this.__value = Uint64.normalizeValue(BigInt(value));
    }

    set value(newValue: bigint) {
        this.__value = Uint64.normalizeValue(newValue);
    }
    get value(): bigint {
        return this.__value;
    }

    public static normalizeValue(value: bigint): bigint {
        value = Uint64.MIN > value ? Uint64.MIN : value;
        value = Uint64.MAX < value ? Uint64.MAX : value;
        return value;
    }
}
interface Uint64Constructor extends UnsignedIntegerWrapperConstructor {
    readonly BYTES: 8;
    readonly MAX: bigint;
}
export const Uint64Type = Uint64 satisfies Uint64Constructor;

export class Float16 implements NumberWrapperInterface {
    public static readonly BYTES = 2;
    public static readonly FLOAT = true;
    public static readonly MIN = -1 * (2 - (2**-10)) * (2**15);
    public static readonly MAX = -1 * Float16.MIN;
    public static readonly DECIMAL_DIGITS = 4;

    private __value: number;

    constructor(value: number | bigint) {
        this.__value = Float16.normalizeValue(Number(value));
    }

    set value(newValue: number) {
        this.__value = Float16.normalizeValue(newValue);
    }
    get value(): number {
        return this.__value;
    }

    public static normalizeValue(value: number): number {
        value = Math.min(Math.max(Float16.MIN, value), Float16.MAX);
        if (Number.isNaN(value)) {
            value = 0;
        }
        // return roundToDecimal(value, Float16.DECIMAL_DIGITS);
        return Math.f16round(value);
    }
}
interface Float16Constructor extends FloatWrapperConstructor {
    readonly BYTES: 2;
    readonly DECIMAL_DIGITS: 4;
}
export const Float16Type = Float16 satisfies Float16Constructor;

export class Float32 implements NumberWrapperInterface {
    public static readonly BYTES = 4;
    public static readonly FLOAT = true;
    public static readonly MIN = -1 * (2 - (2**-23)) * (2**127);
    public static readonly MAX = -1 * Float32.MIN;
    public static readonly DECIMAL_DIGITS = 6;

    private __value: number;

    constructor(value: number | bigint) {
        this.__value = Float32.normalizeValue(Number(value));
    }

    set value(newValue: number) {
        this.__value = Float32.normalizeValue(newValue);
    }
    get value(): number {
        return this.__value;
    }

    public static normalizeValue(value: number): number {
        value = Math.min(Math.max(Float32.MIN, value), Float32.MAX);
        if (Number.isNaN(value)) {
            value = 0;
        }
        // return roundToDecimal(value, Float32.DECIMAL_DIGITS);
        return Math.fround(value);
    }
}
interface Float32Constructor extends FloatWrapperConstructor {
    readonly BYTES: 4;
    readonly DECIMAL_DIGITS: 6;
}
export const Float32Type = Float32 satisfies Float32Constructor;

export class Float64 implements NumberWrapperInterface {
    public static readonly BYTES = 8;
    public static readonly FLOAT = true;
    public static readonly MIN = -1 * (2 - (2**-52)) * (2**1023);
    public static readonly MAX = -1 * Float64.MIN;
    public static readonly DECIMAL_DIGITS = 15;

    private __value: number;

    constructor(value: number | bigint) {
        this.__value = Float64.normalizeValue(Number(value));
    }

    set value(newValue: number) {
        this.__value = Float64.normalizeValue(newValue);
    }
    get value(): number {
        return this.__value;
    }

    public static normalizeValue(value: number): number {
        value = Math.min(Math.max(Float64.MIN, value), Float64.MAX);
        if (Number.isNaN(value)) {
            value = 0;
        }
        // return roundToDecimal(value, Float64.DECIMAL_DIGITS);
        return value;
    }
}
interface Float64Constructor extends FloatWrapperConstructor {
    readonly BYTES: 8;
    readonly DECIMAL_DIGITS: 15;
}
export const Float64Type = Float64 satisfies Float64Constructor;

export type NumberWrapperTypes =
    typeof Int8Type |
    typeof Int16Type |
    typeof Int32Type |
    typeof Int64Type |
    typeof Uint8Type |
    typeof Uint16Type |
    typeof Uint32Type |
    typeof Uint64Type |
    typeof Float16Type |
    typeof Float32Type |
    typeof Float64Type
;
export type BigIntWrappers = typeof Int64 | typeof Uint64;
export type NonBigIntWrappers = Exclude<NumberWrapperTypes, BigIntWrappers>;

function roundToDecimal(num: number, decimalDigits: number): number {
    const factor = 10 ** decimalDigits;
    return Math.round(num * factor) / factor;
}