export default function arrayEquals<T extends Object>(arr1: ArrayLike<T>, arr2: ArrayLike<T>): boolean {
    const { constructor } = arr1;
    const arr2Constructor = arr2.constructor;
    if (constructor !== arr2Constructor) {
        throw new Error(
            `Cannot test equality of arrays with differing constructors:`+
            `\n${constructor.name} & ${arr2Constructor.name}`
        );
    }

    if (arr1.length !== arr2.length) {
        return false;
    }

    for (let i=0; i<arr1.length; i++) {
        const it1 = arr1[i];
        const it2 = arr2[i];
        // console.log(`(${it1}, ${it2})`);
        const proto1 = Object.getPrototypeOf(it1);
        const proto2 = Object.getPrototypeOf(it2);
        if (Object.hasOwn(proto1, "equals") && Object.hasOwn(proto2, "equals")) {
            type EqualsMethod = (it: T) => boolean;

            if (!(it1 as T & { equals: EqualsMethod }).equals(it2)) {
                // console.error("r");
                return false;
            }
        }

        if (it1.constructor === constructor && it2.constructor === constructor) {
            type ItemArray = ArrayLike<Object>;
            if (!arrayEquals(it1 as unknown as ItemArray, it2 as unknown as ItemArray)) {
                // console.error("u");
                return false;
            }
        }

        if (it1 !== it2) {
            return false;
        }
    }

    return true;
}