export declare const getRecordSize: <Key extends string | number | symbol, Value extends any>(record: Record<Key, Value>) => number;
export declare const pushToRecord: <Value extends any>(record: Record<any, Value>, value: Value) => void;
