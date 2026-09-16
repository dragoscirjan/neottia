type Comparator = (a: any, b: any) => Promise<-1 | 0 | 1>;
export declare const sortAsynchronously: (array: Array<any>, comparator: Comparator) => Promise<any[]>;
export {};
