'use strict';

var Levenshtein = require('levenshtein');
var Path = require('path');
var rtrim = require('locutus/php/strings/rtrim').rtrim;
var luxon = require('luxon');
var isPlainObject$1 = require('is-plain-object');
var parser = require('regex-parser');
var phpRange = require('locutus/php/array/range').range;
var array_chunk = require('locutus/php/array/array_chunk').array_chunk;
var array_merge = require('locutus/php/array/array_merge').array_merge;
var snakeCase = require('snake-case');
var isObject = require('isobject');
var twigLexer = require('twig-lexer');
var strings = require('locutus/php/strings/index');
var phpSprintf = require('locutus/php/strings/sprintf').sprintf;
var phpRawurlencode = require('locutus/php/url/rawurlencode').rawurlencode;
var phpOrd = require('locutus/php/strings/ord').ord;
var sourceMap = require('source-map');
var math = require('locutus/php/math/index');
var pad = require('pad');
var phpStrtr = require('locutus/php/strings/strtr').strtr;
var phpNumberFormat = require('locutus/php/strings/number_format').number_format;
var phpHttpBuildQuery = require('locutus/php/url/http_build_query').http_build_query;
var IconVLite = require('iconv-lite');
var phpUcwords = require('locutus/php/strings/ucwords').ucwords;
var words = require('capitalize');
var phpStripTags = require('locutus/php/strings/strip_tags').strip_tags;
var phpTrim = require('locutus/php/strings/trim').trim;
var phpLeftTrim = require('locutus/php/strings/ltrim').ltrim;
var phpNl2br = require('locutus/php/strings/nl2br').nl2br;
var explode = require('locutus/php/strings/explode').explode;
var esrever = require('esrever');
var phpRound = require('locutus/php/math/round').round;
var phpCeil = require('locutus/php/math/ceil').ceil;
var phpFloor = require('locutus/php/math/floor').floor;
var runes = require('runes');
var mt_rand = require('locutus/php/math/mt_rand').mt_rand;
var array_rand = require('locutus/php/array/array_rand').array_rand;

function _interopNamespaceDefault(e) {
    var n = Object.create(null);
    if (e) {
        Object.keys(e).forEach(function (k) {
            if (k !== 'default') {
                var d = Object.getOwnPropertyDescriptor(e, k);
                Object.defineProperty(n, k, d.get ? d : {
                    enumerable: true,
                    get: function () { return e[k]; }
                });
            }
        });
    }
    n.default = e;
    return Object.freeze(n);
}

var Path__namespace = /*#__PURE__*/_interopNamespaceDefault(Path);

const createBaseError = (name, message, location, source, previous) => {
    const baseError = Error(message);
    baseError.name = name;
    const error = Object.create(baseError, {
        location: {
            get: () => location
        },
        source: {
            get: () => source
        },
        previous: {
            value: previous
        },
        rootMessage: {
            value: message
        },
        appendMessage: {
            value: (value) => {
                message += value;
                updateRepresentation();
            }
        }
    });
    const updateRepresentation = () => {
        let representation = message;
        let dot = false;
        if (representation.slice(-1) === '.') {
            representation = representation.slice(0, -1);
            dot = true;
        }
        let questionMark = false;
        if (representation.slice(-1) === '?') {
            representation = representation.slice(0, -1);
            questionMark = true;
        }
        representation += ` in "${source.name}"`;
        const { line, column } = location;
        representation += ` at line ${line}, column ${column}`;
        if (dot) {
            representation += '.';
        }
        if (questionMark) {
            representation += '?';
        }
        baseError.message = representation;
    };
    updateRepresentation();
    Error.captureStackTrace(error, createBaseError);
    return error;
};

const parsingErrorName = 'TwingParsingError';
const createParsingError = (message, location, source, previous) => {
    const baseError = createBaseError(parsingErrorName, message, location, source, previous);
    Error.captureStackTrace(baseError, createParsingError);
    return Object.create(baseError, {
        addSuggestions: {
            value: (name, items) => {
                const alternatives = [];
                for (const item of items) {
                    const levenshtein = new Levenshtein(name, item);
                    if (levenshtein.distance <= (name.length / 3) || item.indexOf(name) > -1) {
                        alternatives.push(item);
                    }
                }
                if (alternatives.length < 1) {
                    return;
                }
                alternatives.sort();
                baseError.appendMessage(` Did you mean "${alternatives.join(', ')}"?`);
            }
        }
    });
};

const runtimeErrorName = 'TwingRuntimeError';
const createRuntimeError = (message, location, source, previous) => {
    const error = createBaseError(runtimeErrorName, message, location, source, previous);
    Error.captureStackTrace(error, createRuntimeError);
    return error;
};

const isATwingError = (candidate) => {
    return [
        parsingErrorName,
        runtimeErrorName
    ].includes(candidate.name);
};

const createTemplateLoadingError = (names) => {
    let message;
    if (names.length === 1) {
        const name = names[0];
        message = `Unable to find template "${name ? name : ''}".`;
    }
    else {
        message = `Unable to find one of the following templates: "${names.join('", "')}".`;
    }
    const error = Error(message);
    Error.captureStackTrace(error, createTemplateLoadingError);
    return error;
};

const createSource = (name, code) => {
    return {
        get code() {
            return code;
        },
        get name() {
            return name;
        }
    };
};

const { join: join$1, dirname, normalize } = Path__namespace.posix;
const createFilesystemLoader = (filesystem) => {
    const namespacedPaths = new Map();
    const stat = (path) => {
        return new Promise((resolve) => {
            filesystem.stat(path, (error, stats) => {
                if (error) {
                    resolve(null);
                }
                else {
                    resolve(stats);
                }
            });
        });
    };
    const resolvePathFromSource = (name, from) => {
        return join$1(dirname(from), name);
    };
    /**
     * If the name starts with a slash, resolve absolutely;
     * else, if the name starts with a dot, resolve relatively to the passed _from_;
     * else, resolve from the namespace.
     */
    const resolve = (name, from) => {
        const findTemplateInPath = async (path) => {
            const stats = await stat(path);
            if (stats && stats.isFile()) {
                return Promise.resolve(path);
            }
            else {
                return Promise.resolve(null);
            }
        };
        if (name.startsWith('/')) {
            // If the name starts with a slash, resolve absolutely;
            return findTemplateInPath(name);
        }
        else if (name.startsWith('.')) {
            // else, if the name starts with a dot, resolve relatively to the passed _from_;
            name = normalize(from ? resolvePathFromSource(name, from) : name);
            return findTemplateInPath(name);
        }
        else {
            // else, resolve from the namespace.
            const [namespace, shortname] = parseName(name);
            // todo: we keep the fallback to ['.'] for backward compatibility purpose; with Twing 8, we can be more restrictive.
            const paths = namespacedPaths.get(namespace) || ['.'];
            const findTemplateInPathAtIndex = async (index) => {
                if (index < paths.length) {
                    const path = paths[index];
                    const templatePath = await findTemplateInPath(join$1(path, shortname));
                    if (templatePath) {
                        return Promise.resolve(templatePath);
                    }
                    else {
                        // let's continue searching
                        return findTemplateInPathAtIndex(index + 1);
                    }
                }
                else {
                    return Promise.resolve(null);
                }
            };
            return findTemplateInPathAtIndex(0);
        }
    };
    const parseName = (name) => {
        const position = name.indexOf('/');
        const potentialNamespace = name.substring(0, position);
        if (namespacedPaths.get(potentialNamespace) !== undefined) {
            const shortname = name.substring(position + 1);
            return [potentialNamespace, shortname];
        }
        return [null, name];
    };
    const addPath = (path, namespace = null) => {
        let namespacePaths = namespacedPaths.get(namespace);
        if (!namespacePaths) {
            namespacePaths = [];
            namespacedPaths.set(namespace, namespacePaths);
        }
        namespacePaths.push(rtrim(path, '\/\\\\'));
    };
    const prependPath = (path, namespace = null) => {
        path = rtrim(path, '\/\\\\');
        const namespacePaths = namespacedPaths.get(namespace);
        if (!namespacePaths) {
            namespacedPaths.set(namespace, [path]);
        }
        else {
            namespacePaths.unshift(path);
        }
    };
    return {
        addPath,
        exists: (name, from) => {
            return resolve(name, from)
                .then((path) => {
                return path !== null;
            });
        },
        resolve,
        getSource: (name, from) => {
            return resolve(name, from)
                .then((path) => {
                if (path === null) {
                    return null;
                }
                else {
                    return new Promise((resolve, reject) => {
                        filesystem.readFile(path, (error, data) => {
                            if (error) {
                                reject(error);
                            }
                            else {
                                resolve(createSource(path, data.toString()));
                            }
                        });
                    });
                }
            });
        },
        isFresh: (name, time, from) => {
            return resolve(name, from)
                .then((path) => {
                if (path === null) {
                    return true;
                }
                else {
                    return stat(path)
                        .then((stats) => {
                        return stats.mtime.getTime() <= time;
                    });
                }
            });
        },
        prependPath
    };
};
const createSynchronousFilesystemLoader = (filesystem) => {
    const namespacedPaths = new Map();
    const stat = (path) => {
        try {
            return filesystem.statSync(path);
        }
        catch (error) {
            return null;
        }
    };
    const resolvePathFromSource = (name, from) => {
        return join$1(dirname(from), name);
    };
    /**
     * If the name starts with a slash, resolve absolutely;
     * else, if the name starts with a dot, resolve relatively to the passed _from_;
     * else, resolve from the namespace.
     */
    const resolve = (name, from) => {
        const findTemplateInPath = (path) => {
            const stats = stat(path);
            if (stats && stats.isFile()) {
                return path;
            }
            else {
                return null;
            }
        };
        if (name.startsWith('/')) {
            // If the name starts with a slash, resolve absolutely;
            return findTemplateInPath(name);
        }
        else if (name.startsWith('.')) {
            // else, if the name starts with a dot, resolve relatively to the passed _from_;
            name = normalize(from ? resolvePathFromSource(name, from) : name);
            return findTemplateInPath(name);
        }
        else {
            // else, resolve from the namespace.
            const [namespace, shortname] = parseName(name);
            // todo: we keep the fallback to ['.'] for backward compatibility purpose; with Twing 8, we can be more restrictive.
            const paths = namespacedPaths.get(namespace) || ['.'];
            const findTemplateInPathAtIndex = (index) => {
                if (index < paths.length) {
                    const path = paths[index];
                    const templatePath = findTemplateInPath(join$1(path, shortname));
                    if (templatePath) {
                        return templatePath;
                    }
                    else {
                        // let's continue searching
                        return findTemplateInPathAtIndex(index + 1);
                    }
                }
                else {
                    return null;
                }
            };
            return findTemplateInPathAtIndex(0);
        }
    };
    const parseName = (name) => {
        const position = name.indexOf('/');
        const potentialNamespace = name.substring(0, position);
        if (namespacedPaths.get(potentialNamespace) !== undefined) {
            const shortname = name.substring(position + 1);
            return [potentialNamespace, shortname];
        }
        return [null, name];
    };
    const addPath = (path, namespace = null) => {
        let namespacePaths = namespacedPaths.get(namespace);
        if (!namespacePaths) {
            namespacePaths = [];
            namespacedPaths.set(namespace, namespacePaths);
        }
        namespacePaths.push(rtrim(path, '\/\\\\'));
    };
    const prependPath = (path, namespace = null) => {
        path = rtrim(path, '\/\\\\');
        const namespacePaths = namespacedPaths.get(namespace);
        if (!namespacePaths) {
            namespacedPaths.set(namespace, [path]);
        }
        else {
            namespacePaths.unshift(path);
        }
    };
    return {
        addPath,
        exists: (name, from) => {
            const path = resolve(name, from);
            return path !== null;
        },
        resolve,
        getSource: (name, from) => {
            const path = resolve(name, from);
            if (path === null) {
                return null;
            }
            else {
                const data = filesystem.readFileSync(path);
                return createSource(path, data.toString());
            }
        },
        isFresh: (name, time, from) => {
            const path = resolve(name, from);
            if (path === null) {
                return true;
            }
            else {
                const stats = stat(path);
                return stats.mtime.getTime() <= time;
            }
        },
        prependPath
    };
};

const createArrayLoader = (templates) => {
    const loader = {
        setTemplate: (name, template) => {
            templates[name] = template;
        },
        getSource: (name, from) => {
            return loader.exists(name, from)
                .then((exists) => {
                if (!exists) {
                    return null;
                }
                return createSource(name, templates[name]);
            });
        },
        exists(name) {
            return Promise.resolve(templates[name] !== undefined);
        },
        resolve: (name, from) => {
            return loader.exists(name, from)
                .then((exists) => {
                if (!exists) {
                    return null;
                }
                return name;
            });
        },
        isFresh: () => {
            return Promise.resolve(true);
        }
    };
    return loader;
};
const createSynchronousArrayLoader = (templates) => {
    const loader = {
        setTemplate: (name, template) => {
            templates[name] = template;
        },
        getSource: (name, from) => {
            if (loader.exists(name, from)) {
                return createSource(name, templates[name]);
            }
            return null;
        },
        exists(name) {
            return templates[name] !== undefined;
        },
        resolve: (name, from) => {
            if (loader.exists(name, from)) {
                return name;
            }
            return null;
        },
        isFresh: () => {
            return true;
        }
    };
    return loader;
};

const createChainLoader = (loaders) => {
    let existsCache = new Map();
    const addLoader = (loader) => {
        loaders.push(loader);
        existsCache = new Map();
    };
    const loader = {
        get loaders() {
            return loaders;
        },
        addLoader,
        exists: (name, from) => {
            const cachedResult = existsCache.get(name);
            if (cachedResult) {
                return Promise.resolve(cachedResult);
            }
            const existsAtIndex = (index) => {
                if (index < loaders.length) {
                    const loader = loaders[index];
                    return loader.exists(name, from)
                        .then((exists) => {
                        existsCache.set(name, exists);
                        if (!exists) {
                            return existsAtIndex(index + 1);
                        }
                        else {
                            return true;
                        }
                    });
                }
                else {
                    return Promise.resolve(false);
                }
            };
            return existsAtIndex(0).then((exists) => {
                existsCache.set(name, exists);
                return exists;
            });
        },
        resolve: (name, from) => {
            const resolveAtIndex = (index) => {
                if (index < loaders.length) {
                    const loader = loaders[index];
                    return loader.exists(name, from)
                        .then((exists) => {
                        if (!exists) {
                            return resolveAtIndex(index + 1);
                        }
                        else {
                            return loader.resolve(name, from);
                        }
                    })
                        .then((key) => {
                        if (key === null) {
                            return resolveAtIndex(index + 1);
                        }
                        return key;
                    });
                }
                else {
                    return Promise.resolve(null);
                }
            };
            return resolveAtIndex(0)
                .then((key) => {
                if (key) {
                    return key;
                }
                else {
                    return null;
                }
            });
        },
        getSource: (name, from) => {
            const getSourceContextAtIndex = (index) => {
                if (index < loaders.length) {
                    let loader = loaders[index];
                    return loader.getSource(name, from)
                        .then((source) => {
                        if (source === null) {
                            return getSourceContextAtIndex(index + 1);
                        }
                        return source;
                    });
                }
                else {
                    return Promise.resolve(null);
                }
            };
            return getSourceContextAtIndex(0)
                .then((source) => {
                if (source) {
                    return source;
                }
                else {
                    return null;
                }
            });
        },
        isFresh: (name, time, from) => {
            const isFreshAtIndex = (index) => {
                if (index < loaders.length) {
                    const loader = loaders[index];
                    return loader.isFresh(name, time, from)
                        .then((isFresh) => {
                        if (isFresh === null) {
                            return isFreshAtIndex(index + 1);
                        }
                        return isFresh;
                    });
                }
                else {
                    return Promise.resolve(null);
                }
            };
            return isFreshAtIndex(0);
        }
    };
    return loader;
};
const createSynchronousChainLoader = (loaders) => {
    let existsCache = new Map();
    const addLoader = (loader) => {
        loaders.push(loader);
        existsCache = new Map();
    };
    const loader = {
        get loaders() {
            return loaders;
        },
        addLoader,
        exists: (name, from) => {
            const cachedResult = existsCache.get(name);
            if (cachedResult) {
                return cachedResult;
            }
            const existsAtIndex = (index) => {
                if (index < loaders.length) {
                    const loader = loaders[index];
                    const exists = loader.exists(name, from);
                    existsCache.set(name, exists);
                    if (!exists) {
                        return existsAtIndex(index + 1);
                    }
                    else {
                        return true;
                    }
                }
                else {
                    return false;
                }
            };
            const exists = existsAtIndex(0);
            existsCache.set(name, exists);
            return exists;
        },
        resolve: (name, from) => {
            const resolveAtIndex = (index) => {
                if (index < loaders.length) {
                    const loader = loaders[index];
                    const exists = loader.exists(name, from);
                    const key = exists ? loader.resolve(name, from) : resolveAtIndex(index + 1);
                    if (key === null) {
                        return resolveAtIndex(index + 1);
                    }
                    return key;
                }
                else {
                    return null;
                }
            };
            const key = resolveAtIndex(0);
            if (key) {
                return key;
            }
            else {
                return null;
            }
        },
        getSource: (name, from) => {
            const getSourceContextAtIndex = (index) => {
                if (index < loaders.length) {
                    let loader = loaders[index];
                    const source = loader.getSource(name, from);
                    if (source === null) {
                        return getSourceContextAtIndex(index + 1);
                    }
                    return source;
                }
                else {
                    return null;
                }
            };
            const source = getSourceContextAtIndex(0);
            if (source) {
                return source;
            }
            else {
                return null;
            }
        },
        isFresh: (name, time, from) => {
            const isFreshAtIndex = (index) => {
                if (index < loaders.length) {
                    const loader = loaders[index];
                    const isFresh = loader.isFresh(name, time, from);
                    if (isFresh === null) {
                        return isFreshAtIndex(index + 1);
                    }
                    return isFresh;
                }
                else {
                    return null;
                }
            };
            return isFreshAtIndex(0);
        }
    };
    return loader;
};

const isAMarkup = (candidate) => {
    return candidate !== null
        && candidate !== undefined
        && candidate.charset !== undefined
        && candidate.content !== undefined
        && candidate.count !== undefined // todo: we should not test getter values but actual property existence
        && candidate.toJSON !== undefined
        && candidate.toString !== undefined;
};
const createMarkup = (content, charset = 'UTF-8') => {
    return {
        get content() {
            return content;
        },
        get charset() {
            return charset;
        },
        get count() {
            return content.length;
        },
        toString() {
            return content.toString();
        },
        toJSON() {
            return content.toString();
        }
    };
};

const getChildren = (node) => {
    return Object.entries(node.children);
};
const getChildrenCount = (node) => {
    return Object.keys(node.children).length;
};
const createBaseNode = (type, attributes = {}, children = {}, line = 0, column = 0, tag = null) => {
    return {
        attributes,
        children,
        column,
        line,
        tag,
        type
    };
};
/**
 * Create a node acting as a container for the passed list of indexed nodes.
 *
 * @param children The children of the created node
 * @param line The line of the created node
 * @param column The column of the created node
 * @param tag The tag of the created node
 */
const createNode = (children = {}, line = 0, column = 0, tag = null) => {
    return createBaseNode(null, {}, children, line, column, tag);
};

const createApplyNode = (filters, body, line, column) => {
    return createBaseNode("apply", {}, {
        body,
        filters
    }, line, column, 'apply');
};

const createAutoEscapeNode = (strategy, body, line, column, tag) => {
    return createBaseNode("auto_escape", {
        strategy
    }, {
        body
    }, line, column, tag);
};

const createBlockNode = (name, body, line, column, tag = null) => {
    return createBaseNode("block", { name }, { body }, line, column, tag);
};

const createBlockReferenceNode = (name, line, column, tag) => {
    return createBaseNode("block_reference", {
        name
    }, {}, line, column, tag);
};

const createCheckSecurityNode = (usedFilters, usedTags, usedFunctions, line, column) => {
    return createBaseNode("check_security", {
        usedFilters,
        usedTags,
        usedFunctions
    }, {}, line, column);
};

const createCheckToStringNode = (value, line, column) => {
    return createBaseNode("check_to_string", {}, {
        value
    }, line, column);
};

const createCommentNode = (data, line, column) => {
    return createBaseNode("comment", {
        data
    }, {}, line, column);
};

const createDeprecatedNode = (message, line, column, tag) => {
    return createBaseNode("deprecated", {}, {
        message
    }, line, column, tag);
};

const createDoNode = (body, line, column, tag) => {
    return createBaseNode("do", {}, {
        body
    }, line, column, tag);
};

const createFlushNode = (line, column, tag) => {
    return createBaseNode("flush", {}, {}, line, column, tag);
};

const createForLoopNode = (line, column, tag) => {
    return createBaseNode("for_loop", {
        hasAnIf: false,
        hasAnElse: false
    }, {}, line, column, tag);
};

const createIfNode = (testNode, elseNode, line, column, tag = null) => {
    const children = {
        tests: testNode
    };
    if (elseNode) {
        children.else = elseNode;
    }
    return createBaseNode('if', {}, children, line, column, tag);
};

const createForNode = (keyTarget, valueTarget, sequence, ifExpression, body, elseNode, line, column, tag) => {
    const loop = createForLoopNode(line, column, tag);
    const bodyChildren = {};
    let i = 0;
    bodyChildren[i++] = body;
    bodyChildren[i++] = loop;
    let actualBody = createNode(bodyChildren, line, column);
    if (ifExpression) {
        const ifChildren = {};
        let i = 0;
        ifChildren[i++] = ifExpression;
        ifChildren[i++] = actualBody;
        actualBody = createIfNode(createNode(ifChildren, line, column), null, line, column);
        loop.attributes.hasAnIf = true;
    }
    const children = {
        keyTarget: keyTarget,
        valueTarget: valueTarget,
        sequence: sequence,
        body: actualBody
    };
    if (elseNode) {
        children.else = elseNode;
        loop.attributes.hasAnElse = true;
    }
    return createBaseNode("for", {
        hasAnIf: ifExpression !== null
    }, children, line, column, tag);
};

const createImportNode = (templateName, alias, global, line, column, tag) => {
    return createBaseNode("import", {
        global
    }, {
        templateName,
        alias
    }, line, column, tag);
};

const createBaseIncludeNode = (type, attributes, children, line, column, tag) => {
    return createBaseNode(type, attributes, children, line, column, tag);
};

const createLineNode = (data, line, column, tag) => {
    return createBaseNode("line", {
        data
    }, {}, line, column, tag);
};

const VARARGS_NAME = 'varargs';
const createMacroNode = (name, body, macroArguments, line, column, tag) => {
    return createBaseNode("macro", {
        name
    }, {
        body,
        arguments: macroArguments
    }, line, column, tag);
};

const createPrintNode = (expression, line, column) => {
    return createBaseNode("print", {}, {
        expression: expression
    }, line, column, null);
};

const createSandboxNode = (body, line, column, tag) => {
    return createBaseNode("sandbox", {}, {
        body
    }, line, column, tag);
};

const createBaseExpressionNode = createBaseNode;

const createConstantNode = (value, line, column) => {
    return createBaseExpressionNode("constant", {
        value
    }, {}, line, column);
};

const createSetNode = (captures, names, values, line, column, tag) => {
    const setNode = createBaseNode("set", {
        captures
    }, {
        names,
        values
    }, line, column, tag);
    /*
     * Optimizes the node when capture is used for a large block of text.
     *
     * {% set foo %}foo{% endset %} is compiled to $context['foo'] = new Twig_Markup("foo");
     */
    if (setNode.attributes.captures) {
        const values = setNode.children.values;
        if (values.type === "text") {
            setNode.children.values = createNode({
                0: createConstantNode(values.attributes.data, values.line, values.column)
            }, values.line, values.column);
            setNode.attributes.captures = false;
        }
    }
    return setNode;
};

const createSpacelessNode = (body, line, column, tag) => {
    return createBaseNode("spaceless", {}, {
        body
    }, line, column, tag);
};

const createTemplateNode = (body, parent, blocks, macros, traits, embeddedTemplates, source, line, column) => {
    const children = {
        body,
        blocks,
        macros,
        traits,
        securityCheck: createNode()
    };
    if (parent !== null) {
        children.parent = parent;
    }
    const baseNode = createBaseNode("template", {
        index: 0,
        source
    }, children, line, column);
    return Object.assign(Object.assign({}, baseNode), { get embeddedTemplates() {
            return embeddedTemplates;
        } });
};

const createBaseTextNode = (type, data, line, column, tag = null) => {
    return createBaseNode(type, {
        data
    }, {}, line, column, tag);
};
const createTextNode = (data, line, column) => createBaseTextNode("text", data, line, column);

const createTraitNode = (template, targets, line, column) => {
    return Object.assign({}, createBaseNode("trait", {}, {
        template,
        targets
    }, line, column));
};

const createVerbatimNode = (data, line, column, tag) => createBaseTextNode("verbatim", data, line, column, tag);

const createWithNode = (body, variables, only, line, column, tag) => {
    const children = {
        body
    };
    if (variables) {
        children.variables = variables;
    }
    return createBaseNode("with", {
        only
    }, children, line, column, tag);
};

const getRecordSize = (record) => {
    return Object.keys(record).length;
};
const pushToRecord = (record, value) => {
    const size = getRecordSize(record);
    record[size] = value;
};

const createBaseArrayNode = (type, elements, line, column) => {
    const children = {};
    for (const { key, value } of elements) {
        pushToRecord(children, key);
        pushToRecord(children, value);
    }
    return createBaseExpressionNode(type, {}, children, line, column);
};
const createArrayNode = (elements, line, column) => {
    let index = 0;
    const baseNode = createBaseArrayNode("array", elements.map(({ key, value }) => {
        return {
            key: key || createConstantNode(index++, line, column),
            value
        };
    }), line, column);
    return Object.assign({}, baseNode);
};

const createArrowFunctionNode = (body, names, line, column) => {
    return createBaseExpressionNode("arrow_function", {}, {
        body,
        names
    }, line, column);
};

// todo: probably a useless node
const createAssignmentNode = (name, line, column) => {
    return createBaseNode("assignment", {
        name
    }, {}, line, column);
};

const createAttributeAccessorNode = (target, attribute, methodArguments, type, line, column) => {
    return createBaseExpressionNode("attribute_accessor", {
        isOptimizable: true,
        type,
        shouldTestExistence: false
    }, {
        target,
        attribute,
        arguments: methodArguments
    }, line, column);
};
const cloneGetAttributeNode = (attributeAccessorNode) => {
    const { children, attributes, line, column } = attributeAccessorNode;
    const { arguments: methodArguments, attribute, target } = children;
    const { type } = attributes;
    return createAttributeAccessorNode(target, attribute, methodArguments, type, line, column);
};

const createBaseBinaryNode = (type, operands, line, column) => {
    const baseNode = createBaseExpressionNode(type, {}, {
        left: operands[0],
        right: operands[1]
    }, line, column);
    return Object.assign({}, baseNode);
};
const createBinaryNodeFactory = (type) => {
    const factory = (operands, line, column) => {
        const baseNode = createBaseBinaryNode(type, operands, line, column);
        return Object.assign({}, baseNode);
    };
    return factory;
};

const createBlockFunctionNode = (name, template, line, column, tag) => {
    const children = {
        name
    };
    if (template) {
        children.template = template;
    }
    return createBaseExpressionNode("block_function", {
        shouldTestExistence: false
    }, children, line, column, tag);
};
const cloneBlockReferenceExpressionNode = (blockFunctionNode) => {
    return createBlockFunctionNode(blockFunctionNode.children.name, blockFunctionNode.children.template || null, blockFunctionNode.line, blockFunctionNode.column);
};

const createBaseCallNode = (type, operatorName, operand, callArguments, line, column) => {
    let children = {
        arguments: callArguments
    };
    if (operand !== null) {
        children.operand = operand;
    }
    return createBaseExpressionNode(type, {
        operatorName
    }, children, line, column);
};

const createBaseConditionalNode = (type, expr1, expr2, expr3, line, column) => {
    return createBaseExpressionNode(type, {}, {
        expr1, expr2, expr3
    }, line, column);
};
const createConditionalNode = (expr1, expr2, expr3, line, column) => createBaseConditionalNode("conditional", expr1, expr2, expr3, line, column);

const createEscapeNode = (body, strategy) => {
    return createBaseExpressionNode("escape", {
        strategy
    }, {
        body
    }, body.line, body.column);
};

const createHashNode = (elements, line, column) => {
    return createBaseArrayNode("hash", elements, line, column);
};

const createMethodCallNode = (operand, methodName, methodArguments, line, column) => {
    return createBaseExpressionNode("method_call", {
        methodName,
        shouldTestExistence: false
    }, {
        operand,
        arguments: methodArguments
    }, line, column);
};
const cloneMethodCallNode = (methodCallNode) => {
    return createMethodCallNode(methodCallNode.children.operand, methodCallNode.attributes.methodName, methodCallNode.children.arguments, methodCallNode.line, methodCallNode.column);
};

const createNameNode = (name, line, column) => {
    const attributes = {
        name,
        isAlwaysDefined: false,
        shouldIgnoreStrictCheck: false,
        shouldTestExistence: false
    };
    return createBaseNode("name", attributes, {}, line, column);
};
const cloneNameNode = (nameNode) => {
    return createNameNode(nameNode.attributes.name, nameNode.line, nameNode.column);
};

const createUnaryNodeFactory = (type) => {
    const factory = (operand, line, column) => {
        const baseNode = createBaseUnaryNode(type, operand, line, column);
        return Object.assign({}, baseNode);
    };
    return factory;
};
const createBaseUnaryNode = (type, operand, line, column) => {
    const baseNode = createBaseExpressionNode(type, {}, {
        operand
    }, line, column);
    return Object.assign({}, baseNode);
};

const createNotNode = createUnaryNodeFactory("not");

const createAndNode = createBinaryNodeFactory("and");

const createTestNode = (operand, testName, testArguments, line, column) => {
    return createBaseCallNode("test", testName, operand, testArguments, line, column);
};

const createNullishCoalescingNode = (operands, line, column) => {
    const [left, right] = operands;
    if (left.type === "name") {
        left.attributes.isAlwaysDefined = true;
    }
    const testNode = createAndNode([
        createTestNode(left, "defined", createArrayNode([], line, column), line, column),
        createNotNode(createTestNode(left, 'null', createArrayNode([], line, column), line, column), line, column)
    ], line, column);
    return createBaseConditionalNode("nullish_coalescing", testNode, left, right, line, column);
};

const createParentFunctionNode = (name, line, column) => {
    return createBaseExpressionNode("parent_function", {
        name,
        //output: false
    }, {}, line, column);
};

const createSpreadNode = (iterable, line, column) => {
    return createBaseExpressionNode("spread", {}, {
        iterable
    }, line, column);
};

const createAddNode = createBinaryNodeFactory("add");

const createBitwiseAndNode = createBinaryNodeFactory("bitwise_and");

const createBitwiseOrNode = createBinaryNodeFactory("bitwise_or");

const createBitwiseXorNode = createBinaryNodeFactory("bitwise_xor");

const createConcatenateNode = createBinaryNodeFactory("concatenate");

const createDivideAndFloorNode = createBinaryNodeFactory("divide_and_floor");

const createDivideNode = createBinaryNodeFactory("divide");

const createEndsWithNode = createBinaryNodeFactory("ends_with");

const createHasEveryNode = createBinaryNodeFactory("has_every");

const createHasSomeNode = createBinaryNodeFactory("has_some");

const createIsEqualNode = createBinaryNodeFactory("is_equal_to");

const createIsGreaterThanNode = createBinaryNodeFactory("is_greater_than");

const createIsGreaterThanOrEqualToNode = createBinaryNodeFactory("is_greater_than_or_equal_to");

const createIsInNode = createBinaryNodeFactory("is_in");

const createIsLessThanNode = createBinaryNodeFactory("is_less_than");

const createIsLessThanOrEqualToNode = createBinaryNodeFactory("is_less_than_or_equal_to");

const createIsNotEqualToNode = createBinaryNodeFactory("is_not_equal_to");

const createIsNotInNode = createBinaryNodeFactory("is_not_in");

const createMatchesNode = createBinaryNodeFactory("matches");

const createModuloNode = createBinaryNodeFactory("modulo");

const createMultiplyNode = createBinaryNodeFactory("multiply");

const createOrNode = createBinaryNodeFactory("or");

const createPowerNode = createBinaryNodeFactory("power");

const createRangeNode = createBinaryNodeFactory("range");

const createStartsWithNode = createBinaryNodeFactory("starts_with");

const createSubtractNode = createBinaryNodeFactory("subtract");

const createFilterNode = (operand, filterName, filterArguments, line, column) => {
    return createBaseCallNode("filter", filterName, operand, filterArguments, line, column);
};

const createFunctionNode = (functionName, functionArguments, line, column) => {
    return createBaseCallNode("function", functionName, null, functionArguments, line, column);
};

const createNegativeNode = createUnaryNodeFactory("negative");

const createPositiveNode = createUnaryNodeFactory("positive");

const createEmbedNode = (attributes, children, line, column, tag) => {
    return createBaseIncludeNode("embed", attributes, children, line, column, tag);
};

const createIncludeNode = (attributes, children, line, column, tag) => {
    return createBaseIncludeNode("include", attributes, children, line, column, tag);
};

/**
 * Converts input to Map.
 *
 * @param {*} thing
 * @returns {Map<any, any>}
 */
const iteratorToMap = (thing) => {
    if (thing.entries) {
        return new Map(thing.entries());
    }
    else {
        const result = new Map();
        if (typeof thing[Symbol.iterator] === 'function') {
            let i = 0;
            for (const value of thing) {
                result.set(i++, value);
            }
        }
        else {
            for (const key in thing) {
                result.set(key, thing[key]);
            }
        }
        return result;
    }
};
const iterableToMap = iteratorToMap;

function isAMapLike(candidate) {
    return candidate !== null &&
        candidate !== undefined &&
        candidate.delete !== undefined &&
        candidate.get !== undefined &&
        candidate.has !== undefined &&
        candidate.set !== undefined &&
        candidate.entries !== undefined;
}
const every = async (iterable, comparator) => {
    if (Array.isArray(iterable)) {
        iterable = iteratorToMap(iterable);
    }
    for (const [key, value] of iterable) {
        if (await comparator(value, key) === false) {
            return false;
        }
    }
    return true;
};
const everySynchronously = (iterable, comparator) => {
    if (Array.isArray(iterable)) {
        iterable = iteratorToMap(iterable);
    }
    for (const [key, value] of iterable) {
        if (comparator(value, key) === false) {
            return false;
        }
    }
    return true;
};
const some = async (iterable, comparator) => {
    if (Array.isArray(iterable)) {
        iterable = iteratorToMap(iterable);
    }
    for (const [key, value] of iterable) {
        if (await comparator(value, key) === true) {
            return true;
        }
    }
    return false;
};
const someSynchronously = (iterable, comparator) => {
    if (Array.isArray(iterable)) {
        iterable = iteratorToMap(iterable);
    }
    for (const [key, value] of iterable) {
        if (comparator(value, key) === true) {
            return true;
        }
    }
    return false;
};

/**
 * Compare by conforming to PHP loose comparisons rules
 *
 * @see http://php.net/manual/en/types.comparisons.php
 * @see https://stackoverflow.com/questions/47969711/php-algorithm-loose-equality-comparison
 */
function compare(firstOperand, secondOperand) {
    // Array<any>
    if (Array.isArray(firstOperand)) {
        firstOperand = iteratorToMap(firstOperand);
    }
    if (Array.isArray(secondOperand)) {
        secondOperand = iteratorToMap(secondOperand);
    }
    // null
    if (firstOperand === null) {
        return compareToNull(secondOperand);
    }
    if (secondOperand === null) {
        return compareToNull(firstOperand);
    }
    // boolean
    if (typeof firstOperand === 'boolean') {
        return compareToBoolean(firstOperand, secondOperand);
    }
    if (typeof secondOperand === 'boolean') {
        return compareToBoolean(secondOperand, firstOperand);
    }
    // number
    if (typeof firstOperand === 'number') {
        return compareToNumber(firstOperand, secondOperand);
    }
    if (typeof secondOperand === 'number') {
        return compareToNumber(secondOperand, firstOperand);
    }
    // TwingMarkup
    if (isAMarkup(firstOperand)) {
        firstOperand = firstOperand.toString();
    }
    if (isAMarkup(secondOperand)) {
        secondOperand = secondOperand.toString();
    }
    // Buffer
    if (Buffer.isBuffer(firstOperand)) {
        firstOperand = firstOperand.toString();
    }
    if (Buffer.isBuffer(secondOperand)) {
        secondOperand = secondOperand.toString();
    }
    // Map
    if (isAMapLike(firstOperand)) {
        return compareToMap(firstOperand, secondOperand);
    }
    // string
    if (typeof firstOperand === 'string') {
        return compareToString(firstOperand, secondOperand);
    }
    // date
    if (firstOperand instanceof luxon.DateTime) {
        return compareToDateTime(firstOperand, secondOperand);
    }
    // fallback to strict comparison
    return firstOperand === secondOperand;
}
/**
 * Compare a Map to something else by conforming to PHP loose comparisons rules
 * ┌─────────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬─────────┬───────┬───────┐
 * │         │ TRUE  │ FALSE │   1   │   0   │  -1   │  "1"  │  "0"  │ "-1"  │ NULL  │ []    │ ["php"] | "php" │  ""   │
 * ├─────────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼─────────┼───────┼───────┤
 * │ []      │ FALSE │ TRUE  │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE │ TRUE  │ TRUE  │ FALSE   │ FALSE │ FALSE |
 * │ ["php"] │ TRUE  │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE │ TRUE    │ FALSE │ FALSE |
 * └─────────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴─────────┴───────┴───────┘
 */
function compareToMap(firstOperand, secondOperand) {
    if (firstOperand.size === 0) {
        return isAMapLike(secondOperand) && (secondOperand.size === 0);
    }
    else {
        if (!isAMapLike(secondOperand)) {
            return false;
        }
        else if (firstOperand.size !== secondOperand.size) {
            return false;
        }
        let result = false;
        for (let [i, valueItem] of firstOperand) {
            let compareItem = secondOperand.get(i);
            result = compare(valueItem, compareItem);
            if (!result) {
                break;
            }
        }
        return result;
    }
}
/**
 * Compare a boolean to something else by conforming to PHP loose comparisons rules
 * ┌─────────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬─────────┬───────┬───────┐
 * │         │ TRUE  │ FALSE │   1   │   0   │  -1   │  "1"  │  "0"  │ "-1"  │ NULL  │ array() │ "php" │  ""   │
 * ├─────────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼─────── ─┼───────┼───────┤
 * │ TRUE    │ TRUE  │ FALSE │ TRUE  │ FALSE │ TRUE  │ TRUE  │ FALSE │ TRUE  │ FALSE │ FALSE   │ TRUE  │ FALSE │
 * │ FALSE   │ FALSE │ TRUE  │ FALSE │ TRUE  │ FALSE │ FALSE │ TRUE  │ FALSE │ TRUE  │ TRUE    │ FALSE │ TRUE  │
 * └─────────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴─────────┴───────┴───────┘
 */
function compareToBoolean(firstOperand, secondOperand) {
    if (secondOperand instanceof luxon.DateTime) {
        return firstOperand === true;
    }
    if (typeof secondOperand === 'boolean') {
        return firstOperand === secondOperand;
    }
    if (typeof secondOperand === 'number') {
        return firstOperand === (secondOperand !== 0);
    }
    if (typeof secondOperand === 'string') {
        if (secondOperand.length > 1) {
            return firstOperand;
        }
        else {
            let float = parseFloat(secondOperand);
            if (!isNaN(float)) {
                return firstOperand === (float !== 0);
            }
            else {
                return firstOperand === (secondOperand.length > 0);
            }
        }
    }
    if (isAMapLike(secondOperand)) {
        return firstOperand === secondOperand.size > 0;
    }
    return firstOperand === true;
}
/**
 * Compare a DateTime to something else by conforming to PHP loose comparisons rules
 * ┌─────────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬─────────┬───────┬───────┬───────┬───────┐
 * │         │ TRUE  │ FALSE │   1   │   0   │  -1   │  "1"  │  "0"  │ "-1"  │ NULL  │ []    │ ["php"] | "php" │  ""   │  NOW  | LATER |
 * ├─────────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼─────────┼───────┼───────┼───────┼───────┤
 * │  NOW    │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE   │ FALSE │ FALSE │ TRUE  │ FALSE │
 * │  LATER  │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE   │ FALSE │ FALSE │ FALSE │ TRUE  │
 * └─────────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴─────────┴───────┴───────┴───────┴───────┘
 */
function compareToDateTime(firstOperand, secondOperand) {
    if (secondOperand instanceof luxon.DateTime) {
        return firstOperand.valueOf() === secondOperand.valueOf();
    }
    return false;
}
/**
 * Compare null to something else by conforming to PHP loose comparisons rules
 * ┌─────────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬─────────┬───────┬───────┐
 * │         │ TRUE  │ FALSE │   1   │   0   │  -1   │  "1"  │  "0"  │ "-1"  │ NULL  │ []    │ ["php"] | "php" │  ""   │
 * ├─────────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼─────────┼───────┼───────┤
 * │ NULL    │ FALSE │ TRUE  │ FALSE │ TRUE  │ FALSE │ FALSE │ FALSE │ FALSE │ TRUE  │ TRUE  │ FALSE   │ FALSE │ TRUE  |
 * └─────────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴─────────┴───────┴───────┘
 */
function compareToNull(value) {
    if (typeof value === 'boolean') {
        return (value === false);
    }
    if (typeof value === 'number') {
        return value === 0;
    }
    if (typeof value === 'string') {
        return value.length < 1;
    }
    if (value === null) {
        return true;
    }
    if (isAMapLike(value)) {
        return value.size < 1;
    }
    return false;
}
/**
 * Compare a number to something else by conforming to PHP loose comparisons rules
 * ┌─────────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬─────────┬───────┬───────┐
 * │         │ TRUE  │ FALSE │   1   │   0   │  -1   │  "1"  │  "0"  │ "-1"  │ NULL  │ array() │ "php" │  ""   │
 * ├─────────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼─────── ─┼───────┼───────┤
 * │ 1       │ TRUE  │ FALSE │ TRUE  │ FALSE │ FALSE │ TRUE  │ FALSE │ FALSE │ FALSE │ FALSE   │ FALSE │ FALSE │
 * │ 0       │ FALSE │ TRUE  │ FALSE │ TRUE  │ FALSE │ FALSE │ TRUE  │ FALSE │ TRUE  │ FALSE   │ TRUE  │ TRUE  │
 * │ -1      │ TRUE  │ FALSE │ FALSE │ FALSE │ TRUE  │ FALSE │ FALSE │ TRUE  │ FALSE │ FALSE   │ FALSE │ FALSE │
 * └─────────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴─────────┴───────┴───────┘
 */
function compareToNumber(firstOperand, secondOperand) {
    if (typeof secondOperand === 'number') {
        return firstOperand === secondOperand;
    }
    if (typeof secondOperand === 'string') {
        let float = parseFloat(secondOperand);
        if (float) {
            return firstOperand === float;
        }
        else {
            return firstOperand === 0;
        }
    }
    // date
    if (secondOperand instanceof luxon.DateTime) {
        return firstOperand === 1;
    }
    return false;
}
/**
 * Compare a string to something else by conforming to PHP loose comparisons rules
 * ┌─────────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬─────────┬───────┬───────┐
 * │         │ TRUE  │ FALSE │   1   │   0   │  -1   │  "1"  │  "0"  │ "-1"  │ NULL  │ array() │ "php" │  ""   │
 * ├─────────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼─────── ─┼───────┼───────┤
 * │ "1"     │ TRUE  │ FALSE │ TRUE  │ FALSE │ FALSE │ TRUE  │ FALSE │ FALSE │ FALSE │ FALSE   │ FALSE │ FALSE │
 * │ "0"     │ FALSE │ TRUE  │ FALSE │ TRUE  │ FALSE │ FALSE │ TRUE  │ FALSE │ FALSE │ FALSE   │ FALSE │ FALSE │
 * │ "-1"    │ TRUE  │ FALSE │ FALSE │ FALSE │ TRUE  │ FALSE │ FALSE │ TRUE  │ FALSE │ FALSE   │ FALSE │ FALSE │
 * │ ""      │ FALSE │ TRUE  │ FALSE │ TRUE  │ FALSE │ FALSE │ FALSE │ FALSE │ TRUE  │ FALSE   │ FALSE │ TRUE  │
 * │ "php"   │ TRUE  │ FALSE │ FALSE │ TRUE  │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE │ FALSE   │ TRUE  │ FALSE │
 * └─────────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴─────────┴───────┴───────┘
 */
function compareToString(firstOperand, secondOperand) {
    if (typeof secondOperand === 'string') {
        return firstOperand === secondOperand;
    }
    return false;
}

const concatenate = (object1, object2) => {
    if ((object1 === null) || (object1 === undefined)) {
        object1 = '';
    }
    if ((object2 === null) || (object2 === undefined)) {
        object2 = '';
    }
    return String(object1) + String(object2);
};

function isPlainObject(thing) {
    return isPlainObject$1(thing);
}

/**
 * Check that an object is traversable in the sense of PHP,
 * i.e. implements PHP Traversable interface
 *
 * @param value
 * @returns {boolean}
 */
function isTraversable(value) {
    if (isPlainObject(value)) {
        return true;
    }
    if ((value !== null) && (value !== undefined)) {
        if (typeof value === 'string') {
            return false;
        }
        if (typeof value['entries'] === 'function') {
            return true;
        }
        if ((typeof value[Symbol.iterator] === 'function') || (typeof value['next'] === 'function')) {
            return true;
        }
    }
    return false;
}

function iteratorToArray(value) {
    if (Array.isArray(value)) {
        return value;
    }
    else {
        let result = [];
        if (value.entries) {
            for (let entry of value.entries()) {
                result.push(entry[1]);
            }
        }
        else if (typeof value[Symbol.iterator] === 'function') {
            for (let entry of value) {
                result.push(entry);
            }
        }
        else if (typeof value['next'] === 'function') {
            let next;
            while ((next = value.next()) && !next.done) {
                result.push(next.value);
            }
        }
        else {
            for (let k in value) {
                result.push(value[k]);
            }
        }
        return result;
    }
}

function isIn(value, compare$1) {
    let result = false;
    if (isAMarkup(value)) {
        value = value.toString();
    }
    if (isAMarkup(compare$1)) {
        compare$1 = compare$1.toString();
    }
    if (isAMapLike(compare$1)) {
        for (let [, item] of compare$1) {
            if (compare(item, value)) {
                result = true;
                break;
            }
        }
    }
    else if (typeof compare$1 === 'string' && (typeof value === 'string' || typeof value === 'number')) {
        result = (value === '' || compare$1.includes('' + value));
    }
    else if (isTraversable(compare$1)) {
        for (let item of iteratorToArray(compare$1)) {
            if (compare(item, value)) {
                result = true;
                break;
            }
        }
    }
    return result;
}

/**
 * @param {string} input
 * @returns {RegExp}
 */
function parseRegularExpression(input) {
    return parser(input);
}

function createRange(low, high, step) {
    let range = phpRange(low, high, step);
    return iteratorToMap(range);
}

const executeBinaryNode = async (node, executionContext) => {
    const { left, right } = node.children;
    const { nodeExecutor: execute, template } = executionContext;
    switch (node.type) {
        case "add": {
            const leftValue = await execute(left, executionContext);
            const leftValueType = typeof leftValue;
            if (leftValueType === "string") {
                return Promise.reject(createRuntimeError(`Unsupported operand type "${leftValueType}"`, left, template.source));
            }
            const rightValue = await execute(right, executionContext);
            const rightValueType = typeof rightValue;
            if (rightValueType === "string") {
                return Promise.reject(createRuntimeError(`Unsupported operand type "${rightValueType}"`, right, template.source));
            }
            return leftValue + rightValue;
        }
        case "and": {
            return !!(await execute(left, executionContext) && await execute(right, executionContext));
        }
        case "bitwise_and": {
            return await execute(left, executionContext) & await execute(right, executionContext);
        }
        case "bitwise_or": {
            return await execute(left, executionContext) | await execute(right, executionContext);
        }
        case "bitwise_xor": {
            return await execute(left, executionContext) ^ await execute(right, executionContext);
        }
        case "concatenate": {
            const leftValue = await execute(left, executionContext);
            const rightValue = await execute(right, executionContext);
            return concatenate(leftValue, rightValue);
        }
        case "divide": {
            return await execute(left, executionContext) / await execute(right, executionContext);
        }
        case "divide_and_floor": {
            return Math.floor(await execute(left, executionContext) / await execute(right, executionContext));
        }
        case "ends_with": {
            const leftValue = await execute(left, executionContext);
            if (typeof leftValue !== "string") {
                return false;
            }
            const rightValue = await execute(right, executionContext);
            if (typeof rightValue !== "string") {
                return false;
            }
            return rightValue.length < 1 || leftValue.endsWith(rightValue);
        }
        case "has_every": {
            const leftValue = await execute(left, executionContext);
            const rightValue = await execute(right, executionContext);
            if (typeof rightValue !== "function") {
                return Promise.resolve(true);
            }
            if (!isAMapLike(leftValue) && !Array.isArray(leftValue)) {
                return Promise.resolve(true);
            }
            return every(leftValue, rightValue);
        }
        case "has_some": {
            const leftValue = await execute(left, executionContext);
            const rightValue = await execute(right, executionContext);
            if (typeof rightValue !== "function") {
                return Promise.resolve(false);
            }
            if (!isAMapLike(leftValue) && !Array.isArray(leftValue)) {
                return Promise.resolve(false);
            }
            return some(leftValue, rightValue);
        }
        case "is_equal_to": {
            const leftValue = await execute(left, executionContext);
            const rightValue = await execute(right, executionContext);
            return compare(leftValue, rightValue);
        }
        case "is_greater_than": {
            return await execute(left, executionContext) > await execute(right, executionContext);
        }
        case "is_greater_than_or_equal_to": {
            return await execute(left, executionContext) >= await execute(right, executionContext);
        }
        case "is_in": {
            return isIn(await execute(left, executionContext), await execute(right, executionContext));
        }
        case "is_less_than": {
            return await execute(left, executionContext) < await execute(right, executionContext);
        }
        case "is_less_than_or_equal_to": {
            return await execute(left, executionContext) <= await execute(right, executionContext);
        }
        case "is_not_equal_to": {
            return Promise.resolve(!compare(await execute(left, executionContext), await execute(right, executionContext)));
        }
        case "is_not_in": {
            return Promise.resolve(!isIn(await execute(left, executionContext), await execute(right, executionContext)));
        }
        case "matches": {
            return parseRegularExpression(await execute(right, executionContext)).test(await execute(left, executionContext));
        }
        case "modulo": {
            return await execute(left, executionContext) % await execute(right, executionContext);
        }
        case "multiply": {
            return await execute(left, executionContext) * await execute(right, executionContext);
        }
        case "or": {
            return !!(await execute(left, executionContext) || await execute(right, executionContext));
        }
        case "power": {
            return Math.pow(await execute(left, executionContext), await execute(right, executionContext));
        }
        case "range": {
            const leftValue = await execute(left, executionContext);
            const rightValue = await execute(right, executionContext);
            return createRange(leftValue, rightValue, 1);
        }
        case "spaceship": {
            const leftValue = await execute(left, executionContext);
            const rightValue = await execute(right, executionContext);
            return compare(leftValue, rightValue) ? 0 : (leftValue < rightValue ? -1 : 1);
        }
        case "starts_with": {
            const leftValue = await execute(left, executionContext);
            if (typeof leftValue !== "string") {
                return false;
            }
            const rightValue = await execute(right, executionContext);
            if (typeof rightValue !== "string") {
                return false;
            }
            return rightValue.length < 1 || leftValue.startsWith(rightValue);
        }
        case "subtract": {
            return await execute(left, executionContext) - await execute(right, executionContext);
        }
    }
    return Promise.reject(createRuntimeError(`Unrecognized binary node of type "${node.type}"`, node, template.source));
};
const executeBinaryNodeSynchronously = (node, executionContext) => {
    const { left, right } = node.children;
    const { nodeExecutor: execute, template } = executionContext;
    switch (node.type) {
        case "add": {
            const leftValue = execute(left, executionContext);
            const leftValueType = typeof leftValue;
            if (leftValueType === "string") {
                throw (createRuntimeError(`Unsupported operand type "${leftValueType}"`, left, template.source));
            }
            const rightValue = execute(right, executionContext);
            const rightValueType = typeof rightValue;
            if (rightValueType === "string") {
                throw (createRuntimeError(`Unsupported operand type "${rightValueType}"`, right, template.source));
            }
            return leftValue + rightValue;
        }
        case "and": {
            return !!(execute(left, executionContext) && execute(right, executionContext));
        }
        case "bitwise_and": {
            return execute(left, executionContext) & execute(right, executionContext);
        }
        case "bitwise_or": {
            return execute(left, executionContext) | execute(right, executionContext);
        }
        case "bitwise_xor": {
            return execute(left, executionContext) ^ execute(right, executionContext);
        }
        case "concatenate": {
            const leftValue = execute(left, executionContext);
            const rightValue = execute(right, executionContext);
            return concatenate(leftValue, rightValue);
        }
        case "divide": {
            return execute(left, executionContext) / execute(right, executionContext);
        }
        case "divide_and_floor": {
            return Math.floor(execute(left, executionContext) / execute(right, executionContext));
        }
        case "ends_with": {
            const leftValue = execute(left, executionContext);
            if (typeof leftValue !== "string") {
                return false;
            }
            const rightValue = execute(right, executionContext);
            if (typeof rightValue !== "string") {
                return false;
            }
            return rightValue.length < 1 || leftValue.endsWith(rightValue);
        }
        case "has_every": {
            const leftValue = execute(left, executionContext);
            const rightValue = execute(right, executionContext);
            if (typeof rightValue !== "function") {
                return true;
            }
            if (!isAMapLike(leftValue) && !Array.isArray(leftValue)) {
                return true;
            }
            return everySynchronously(leftValue, rightValue);
        }
        case "has_some": {
            const leftValue = execute(left, executionContext);
            const rightValue = execute(right, executionContext);
            if (typeof rightValue !== "function") {
                return false;
            }
            if (!isAMapLike(leftValue) && !Array.isArray(leftValue)) {
                return false;
            }
            return someSynchronously(leftValue, rightValue);
        }
        case "is_equal_to": {
            const leftValue = execute(left, executionContext);
            const rightValue = execute(right, executionContext);
            return compare(leftValue, rightValue);
        }
        case "is_greater_than": {
            return execute(left, executionContext) > execute(right, executionContext);
        }
        case "is_greater_than_or_equal_to": {
            return execute(left, executionContext) >= execute(right, executionContext);
        }
        case "is_in": {
            return isIn(execute(left, executionContext), execute(right, executionContext));
        }
        case "is_less_than": {
            return execute(left, executionContext) < execute(right, executionContext);
        }
        case "is_less_than_or_equal_to": {
            return execute(left, executionContext) <= execute(right, executionContext);
        }
        case "is_not_equal_to": {
            return !compare(execute(left, executionContext), execute(right, executionContext));
        }
        case "is_not_in": {
            return !isIn(execute(left, executionContext), execute(right, executionContext));
        }
        case "matches": {
            return parseRegularExpression(execute(right, executionContext)).test(execute(left, executionContext));
        }
        case "modulo": {
            return execute(left, executionContext) % execute(right, executionContext);
        }
        case "multiply": {
            return execute(left, executionContext) * execute(right, executionContext);
        }
        case "or": {
            return !!(execute(left, executionContext) || execute(right, executionContext));
        }
        case "power": {
            return Math.pow(execute(left, executionContext), execute(right, executionContext));
        }
        case "range": {
            const leftValue = execute(left, executionContext);
            const rightValue = execute(right, executionContext);
            return createRange(leftValue, rightValue, 1);
        }
        case "spaceship": {
            const leftValue = execute(left, executionContext);
            const rightValue = execute(right, executionContext);
            return compare(leftValue, rightValue) ? 0 : (leftValue < rightValue ? -1 : 1);
        }
        case "starts_with": {
            const leftValue = execute(left, executionContext);
            if (typeof leftValue !== "string") {
                return false;
            }
            const rightValue = execute(right, executionContext);
            if (typeof rightValue !== "string") {
                return false;
            }
            return rightValue.length < 1 || leftValue.startsWith(rightValue);
        }
        case "subtract": {
            return execute(left, executionContext) - execute(right, executionContext);
        }
    }
    throw createRuntimeError(`Unrecognized binary node of type "${node.type}"`, node, template.source);
};

const executeTemplateNode = (node, executionContext) => {
    const { template, nodeExecutor: execute, outputBuffer, sourceMapRuntime } = executionContext;
    const { securityCheck, body } = node.children;
    return execute(securityCheck, executionContext)
        .then(() => {
        sourceMapRuntime === null || sourceMapRuntime === void 0 ? void 0 : sourceMapRuntime.enterSourceMapBlock(node.line, node.column, node.type, template.source, outputBuffer);
        return execute(body, executionContext).then(() => {
            sourceMapRuntime === null || sourceMapRuntime === void 0 ? void 0 : sourceMapRuntime.leaveSourceMapBlock(outputBuffer);
        });
    });
};
const executeTemplateNodeSynchronously = (node, executionContext) => {
    const { template, nodeExecutor: execute, outputBuffer, sourceMapRuntime } = executionContext;
    const { securityCheck, body } = node.children;
    execute(securityCheck, executionContext);
    sourceMapRuntime === null || sourceMapRuntime === void 0 ? void 0 : sourceMapRuntime.enterSourceMapBlock(node.line, node.column, node.type, template.source, outputBuffer);
    execute(body, executionContext);
    sourceMapRuntime === null || sourceMapRuntime === void 0 ? void 0 : sourceMapRuntime.leaveSourceMapBlock(outputBuffer);
};

const executePrintNode = (node, executionContext) => {
    const { template, nodeExecutor: execute, outputBuffer, sourceMapRuntime } = executionContext;
    sourceMapRuntime === null || sourceMapRuntime === void 0 ? void 0 : sourceMapRuntime.enterSourceMapBlock(node.line, node.column, node.type, template.source, outputBuffer);
    return execute(node.children.expression, executionContext)
        .then((result) => {
        if (Array.isArray(result)) {
            result = 'Array';
        }
        outputBuffer.echo(result);
        sourceMapRuntime === null || sourceMapRuntime === void 0 ? void 0 : sourceMapRuntime.leaveSourceMapBlock(outputBuffer);
    });
};
const executePrintNodeSynchronously = (node, executionContext) => {
    const { template, nodeExecutor: execute, outputBuffer, sourceMapRuntime } = executionContext;
    sourceMapRuntime === null || sourceMapRuntime === void 0 ? void 0 : sourceMapRuntime.enterSourceMapBlock(node.line, node.column, node.type, template.source, outputBuffer);
    let result = execute(node.children.expression, executionContext);
    if (Array.isArray(result)) {
        result = 'Array';
    }
    outputBuffer.echo(result);
    sourceMapRuntime === null || sourceMapRuntime === void 0 ? void 0 : sourceMapRuntime.leaveSourceMapBlock(outputBuffer);
};

const executeTextNode = (textNode, executionContext) => {
    const { template, outputBuffer, sourceMapRuntime } = executionContext;
    sourceMapRuntime === null || sourceMapRuntime === void 0 ? void 0 : sourceMapRuntime.enterSourceMapBlock(textNode.line, textNode.column, textNode.type, template.source, outputBuffer);
    outputBuffer.echo(textNode.attributes.data);
    sourceMapRuntime === null || sourceMapRuntime === void 0 ? void 0 : sourceMapRuntime.leaveSourceMapBlock(outputBuffer);
    return Promise.resolve();
};
const executeTextNodeSynchronously = (textNode, executionContext) => {
    const { template, outputBuffer, sourceMapRuntime } = executionContext;
    sourceMapRuntime === null || sourceMapRuntime === void 0 ? void 0 : sourceMapRuntime.enterSourceMapBlock(textNode.line, textNode.column, textNode.type, template.source, outputBuffer);
    outputBuffer.echo(textNode.attributes.data);
    sourceMapRuntime === null || sourceMapRuntime === void 0 ? void 0 : sourceMapRuntime.leaveSourceMapBlock(outputBuffer);
};

function getTraceableMethod(method, location, templateSource) {
    return ((...args) => {
        return method(...args)
            .catch((error) => {
            if (!isATwingError(error)) {
                throw createRuntimeError(error.message, location, templateSource, error);
            }
            throw error;
        });
    });
}
function getSynchronousTraceableMethod(method, location, templateSource) {
    return ((...args) => {
        try {
            return method(...args);
        }
        catch (error) {
            if (!isATwingError(error)) {
                throw createRuntimeError(error.message, location, templateSource, error);
            }
            throw error;
        }
    });
}

const getKeyValuePairs = (node) => {
    const chunks = array_chunk(Object.values(node.children), 2);
    return chunks.map(([key, value]) => {
        return { key, value };
    });
};

/**
 * Gets a test by name.
 *
 * @param {string} name The test name
 * @returns {TwingTest} A MyTest instance or null if the test does not exist
 */
const getTest = (tests, name) => {
    const result = tests.get(name);
    if (result) {
        return result;
    }
    for (let [pattern, test] of tests) {
        let count = 0;
        pattern = pattern.replace(/\*/g, function () {
            count++;
            return '(.*?)';
        });
        if (count) {
            const regExp = new RegExp('^' + pattern + '$', 'g');
            const match = regExp.exec(name);
            const matches = [];
            if (match) {
                for (let i = 1; i <= count; i++) {
                    matches.push(match[i]);
                }
                test.nativeArguments = matches;
                return test;
            }
        }
    }
    return null;
};

/**
 * Get a function by name.
 *
 * @param {string} name         function name
 * @returns {TwingFunction}     A TwingFunction instance or null if the function does not exist
 */
const getFunction = (functions, name) => {
    const result = functions.get(name);
    if (result) {
        return result;
    }
    for (let [pattern, twingFunction] of functions) {
        let count = 0;
        pattern = pattern.replace(/\*/g, function () {
            count++;
            return '(.*?)';
        });
        if (count) {
            const regExp = new RegExp('^' + pattern + '$', 'g');
            const match = regExp.exec(name);
            const matches = [];
            if (match) {
                for (let i = 1; i <= count; i++) {
                    matches.push(match[i]);
                }
                twingFunction.nativeArguments = matches;
                return twingFunction;
            }
        }
    }
    return null;
};

/**
 * Get a filter by name.
 *
 * @param {string} name The filter name
 *
 * @return {TwingFilter|false} A TwingFilter instance or false if the filter does not exist
 */
const getFilter = (filters, name) => {
    const result = filters.get(name);
    if (result) {
        return result;
    }
    for (let [pattern, filter] of filters) {
        let count = 0;
        pattern = pattern.replace(/\*/g, function () {
            count++;
            return '(.*?)';
        });
        if (count) {
            const regExp = new RegExp('^' + pattern + '$', 'g');
            const match = regExp.exec(name);
            const matches = [];
            if (match) {
                for (let i = 1; i <= count; i++) {
                    matches.push(match[i]);
                }
                filter.nativeArguments = matches;
                return filter;
            }
        }
    }
    return null;
};

const normalizeName = (name) => {
    return snakeCase(name).toLowerCase();
};
const getArguments = (node, template, argumentsNode, acceptedArguments, isVariadic) => {
    const callType = node.type;
    const callName = node.attributes.operatorName;
    const parameters = new Map();
    let named = false;
    const keyPairs = getKeyValuePairs(argumentsNode);
    for (let { key, value } of keyPairs) {
        let name = key.attributes.value;
        if (typeof name === "string") {
            named = true;
            name = normalizeName(name);
        }
        else if (named) {
            throw createRuntimeError(`Positional arguments cannot be used after named arguments for ${callType} "${callName}".`, node, template.source);
        }
        parameters.set(name, {
            key,
            value
        });
    }
    const callableParameters = acceptedArguments;
    const names = [];
    let optionalArguments = [];
    let arguments_ = [];
    let position = 0;
    for (const callableParameter of callableParameters) {
        const name = '' + normalizeName(callableParameter.name);
        names.push(name);
        const parameter = parameters.get(name);
        if (parameter) {
            if (parameters.has(position)) {
                throw createRuntimeError(`Argument "${name}" is defined twice for ${callType} "${callName}".`, node, template.source);
            }
            arguments_ = array_merge(arguments_, optionalArguments);
            arguments_.push(parameter.value);
            parameters.delete(name);
            optionalArguments = [];
        }
        else {
            const parameter = parameters.get(position);
            if (parameter) {
                arguments_ = array_merge(arguments_, optionalArguments);
                arguments_.push(parameter.value);
                parameters.delete(position);
                optionalArguments = [];
                ++position;
            }
            else if (callableParameter.defaultValue !== undefined) {
                arguments_.push(createConstantNode(callableParameter.defaultValue, node.line, node.column));
            }
            else {
                throw createRuntimeError(`Value for argument "${name}" is required for ${callType} "${callName}".`, node, template.source);
            }
        }
    }
    if (isVariadic) {
        const resolvedKeys = [];
        const arbitraryArguments = [];
        for (const [key, value] of parameters) {
            arbitraryArguments.push(value.value);
            resolvedKeys.push(key);
        }
        for (const key of resolvedKeys) {
            parameters.delete(key);
        }
        if (arbitraryArguments.length) {
            arguments_ = array_merge(arguments_, optionalArguments);
            arguments_.push(...arbitraryArguments);
        }
    }
    if (parameters.size > 0) {
        const unknownParameter = [...parameters.values()][0];
        throw createRuntimeError(`Unknown argument${parameters.size > 1 ? 's' : ''} "${[...parameters.keys()].join('", "')}" for ${callType} "${callName}(${names.join(', ')})".`, unknownParameter.key, template.source);
    }
    return arguments_;
};
const executeCallNode = async (node, executionContext) => {
    const { type } = node;
    const { template, environment, nodeExecutor: execute } = executionContext;
    const { operatorName } = node.attributes;
    let callableWrapper;
    switch (type) {
        case "filter":
            callableWrapper = getFilter(environment.filters, operatorName);
            break;
        case "function":
            callableWrapper = getFunction(environment.functions, operatorName);
            break;
        // for some reason, using `case "test"` makes the compiler assume that callableWrapper is used
        // before it is assigned a value; this is probably a bug of the compiler
        default:
            callableWrapper = getTest(environment.tests, operatorName);
            break;
    }
    if (callableWrapper === null) {
        throw createRuntimeError(`Unknown ${type} "${operatorName}".`, node, template.source);
    }
    const { operand, arguments: callArguments } = node.children;
    const argumentNodes = getArguments(node, template, callArguments, callableWrapper.acceptedArguments, callableWrapper.isVariadic);
    const actualArguments = [];
    actualArguments.push(...callableWrapper.nativeArguments);
    if (operand) {
        actualArguments.push(await execute(operand, executionContext));
    }
    const providedArguments = await Promise.all([
        ...argumentNodes.map((node) => execute(node, executionContext))
    ]);
    actualArguments.push(...providedArguments);
    const traceableCallable = getTraceableMethod(callableWrapper.callable, node, template.source);
    return traceableCallable(executionContext, ...actualArguments).then((value) => {
        return value;
    });
};
const executeCallNodeSynchronously = (node, executionContext) => {
    const { type } = node;
    const { template, environment, nodeExecutor: execute } = executionContext;
    const { operatorName } = node.attributes;
    let callableWrapper;
    switch (type) {
        case "filter":
            callableWrapper = getFilter(environment.filters, operatorName);
            break;
        case "function":
            callableWrapper = getFunction(environment.functions, operatorName);
            break;
        // for some reason, using `case "test"` makes the compiler assume that callableWrapper is used
        // before it is assigned a value; this is probably a bug of the compiler
        default:
            callableWrapper = getTest(environment.tests, operatorName);
            break;
    }
    if (callableWrapper === null) {
        throw createRuntimeError(`Unknown ${type} "${operatorName}".`, node, template.source);
    }
    const { operand, arguments: callArguments } = node.children;
    const argumentNodes = getArguments(node, template, callArguments, callableWrapper.acceptedArguments, callableWrapper.isVariadic);
    const actualArguments = [];
    actualArguments.push(...callableWrapper.nativeArguments);
    if (operand) {
        actualArguments.push(execute(operand, executionContext));
    }
    const providedArguments = argumentNodes.map((node) => execute(node, executionContext));
    actualArguments.push(...providedArguments);
    const traceableCallable = getSynchronousTraceableMethod(callableWrapper.callable, node, template.source);
    return traceableCallable(executionContext, ...actualArguments);
};

const executeMethodCall = async (node, executionContext) => {
    const { template, aliases, nodeExecutor: execute } = executionContext;
    const { methodName, shouldTestExistence } = node.attributes;
    const { operand, arguments: methodArguments } = node.children;
    if (shouldTestExistence) {
        return aliases.get(operand.attributes.name).hasMacro(methodName);
    }
    else {
        const keyValuePairs = getKeyValuePairs(methodArguments);
        const macroArguments = [];
        for (const { value: valueNode } of keyValuePairs) {
            const value = await execute(valueNode, executionContext);
            macroArguments.push(value);
        }
        // by nature, the alias exists - the parser only creates a method call node when the name _is_ an alias.
        const macroTemplate = aliases.get(operand.attributes.name);
        const getHandler = (template) => {
            const macroHandler = template.macroHandlers.get(methodName);
            if (macroHandler) {
                return Promise.resolve(macroHandler);
            }
            else {
                return template.getParent(executionContext)
                    .then((parent) => {
                    if (parent) {
                        return getHandler(parent);
                    }
                    else {
                        return null;
                    }
                });
            }
        };
        return getHandler(macroTemplate)
            .then((handler) => {
            if (handler) {
                return handler(executionContext, ...macroArguments);
            }
            else {
                throw createRuntimeError(`Macro "${methodName}" is not defined in template "${macroTemplate.name}".`, node, template.source);
            }
        });
    }
};
const executeMethodCallSynchronously = (node, executionContext) => {
    const { template, aliases, nodeExecutor: execute } = executionContext;
    const { methodName, shouldTestExistence } = node.attributes;
    const { operand, arguments: methodArguments } = node.children;
    if (shouldTestExistence) {
        return aliases[operand.attributes.name].hasMacro(methodName);
    }
    else {
        const keyValuePairs = getKeyValuePairs(methodArguments);
        const macroArguments = [];
        for (const { value: valueNode } of keyValuePairs) {
            const value = execute(valueNode, executionContext);
            macroArguments.push(value);
        }
        // by nature, the alias exists - the parser only creates a method call node when the name _is_ an alias.
        const macroTemplate = aliases[operand.attributes.name];
        const getHandler = (template) => {
            const macroHandler = template.macroHandlers.get(methodName);
            if (macroHandler) {
                return macroHandler;
            }
            else {
                const parent = template.getParent(executionContext);
                if (parent) {
                    return getHandler(parent);
                }
                else {
                    return null;
                }
            }
        };
        const handler = getHandler(macroTemplate);
        if (handler) {
            return handler(executionContext, ...macroArguments);
        }
        else {
            throw createRuntimeError(`Macro "${methodName}" is not defined in template "${macroTemplate.name}".`, node, template.source);
        }
    }
};

const executeAssignmentNode = (node) => {
    return Promise.resolve(node.attributes.name);
};
const executeAssignmentNodeSynchronously = (node) => {
    return node.attributes.name;
};

const executeImportNode = async (node, executionContext) => {
    const { template, aliases, nodeExecutor: execute, } = executionContext;
    const { alias: aliasNode, templateName: templateNameNode } = node.children;
    const { global } = node.attributes;
    let aliasValue;
    if (templateNameNode.type === "name" && templateNameNode.attributes.name === '_self') {
        aliasValue = template;
    }
    else {
        const templateName = await execute(templateNameNode, executionContext);
        const loadTemplate = getTraceableMethod(template.loadTemplate, node, template.source);
        aliasValue = await loadTemplate(executionContext, templateName);
    }
    aliases.set(aliasNode.attributes.name, aliasValue);
    if (global) {
        template.aliases.set(aliasNode.attributes.name, aliasValue);
    }
};
const executeImportNodeSynchronously = (node, executionContext) => {
    const { template, aliases, nodeExecutor: execute, } = executionContext;
    const { alias: aliasNode, templateName: templateNameNode } = node.children;
    const { global } = node.attributes;
    let aliasValue;
    if (templateNameNode.type === "name" && templateNameNode.attributes.name === '_self') {
        aliasValue = template;
    }
    else {
        const templateName = execute(templateNameNode, executionContext);
        const loadTemplate = getSynchronousTraceableMethod(template.loadTemplate, node, template.source);
        aliasValue = loadTemplate(executionContext, templateName);
    }
    aliases[aliasNode.attributes.name] = aliasValue;
    if (global) {
        template.aliases[aliasNode.attributes.name] = aliasValue;
    }
};

const executeParentFunction = (node, executionContext) => {
    const { template, outputBuffer } = executionContext;
    const { name } = node.attributes;
    const displayParentBlock = getTraceableMethod(template.displayParentBlock, node, template.source);
    outputBuffer.start();
    return displayParentBlock(executionContext, name).then(() => outputBuffer.getAndClean());
};
const executeParentFunctionSynchronously = (node, executionContext) => {
    const { template, outputBuffer } = executionContext;
    const { name } = node.attributes;
    const displayParentBlock = getSynchronousTraceableMethod(template.displayParentBlock, node, template.source);
    outputBuffer.start();
    displayParentBlock(executionContext, name);
    return outputBuffer.getAndClean();
};

const executeBlockFunction = async (node, executionContext) => {
    const { template, context, nodeExecutor: execute, blocks, outputBuffer } = executionContext;
    const { template: templateNode, name: blockNameNode } = node.children;
    const blockName = await execute(blockNameNode, executionContext);
    let resolveTemplate;
    if (templateNode) {
        const templateName = await execute(templateNode, executionContext);
        const loadTemplate = getTraceableMethod(template.loadTemplate, templateNode, template.source);
        resolveTemplate = loadTemplate(executionContext, templateName);
    }
    else {
        resolveTemplate = Promise.resolve(template);
    }
    return resolveTemplate
        .then((templateOfTheBlock) => {
        if (node.attributes.shouldTestExistence) {
            const hasBlock = getTraceableMethod(templateOfTheBlock.hasBlock, node, template.source);
            return hasBlock(Object.assign(Object.assign({}, executionContext), { context: context.clone() }), blockName, blocks);
        }
        else {
            const displayBlock = getTraceableMethod(templateOfTheBlock.displayBlock, node, template.source);
            let useBlocks = templateNode === undefined;
            outputBuffer.start();
            return displayBlock(Object.assign(Object.assign({}, executionContext), { context: context.clone() }), blockName, useBlocks).then(() => {
                return outputBuffer.getAndClean();
            });
        }
    });
};
const executeSynchronousBlockFunction = (node, executionContext) => {
    const { template, context, nodeExecutor: execute, blocks, outputBuffer } = executionContext;
    const { template: templateNode, name: blockNameNode } = node.children;
    const blockName = execute(blockNameNode, executionContext);
    let templateOfTheBlock;
    if (templateNode) {
        const templateName = execute(templateNode, executionContext);
        const loadTemplate = getSynchronousTraceableMethod(template.loadTemplate, templateNode, template.source);
        templateOfTheBlock = loadTemplate(executionContext, templateName);
    }
    else {
        templateOfTheBlock = template;
    }
    if (node.attributes.shouldTestExistence) {
        const hasBlock = getSynchronousTraceableMethod(templateOfTheBlock.hasBlock, node, template.source);
        return hasBlock(Object.assign(Object.assign({}, executionContext), { context: new Map(context.entries()) }), blockName, blocks);
    }
    else {
        const displayBlock = getSynchronousTraceableMethod(templateOfTheBlock.displayBlock, node, template.source);
        let useBlocks = templateNode === undefined;
        outputBuffer.start();
        displayBlock(Object.assign(Object.assign({}, executionContext), { context: new Map(context.entries()) }), blockName, useBlocks);
        return outputBuffer.getAndClean();
    }
};

const executeBlockReferenceNode = (node, executionContext) => {
    const { template, context } = executionContext;
    const { name } = node.attributes;
    const displayBlock = getTraceableMethod(template.displayBlock, node, template.source);
    return displayBlock(Object.assign(Object.assign({}, executionContext), { context: context.clone() }), name, true);
};
const executeBlockReferenceNodeSynchronously = (node, executionContext) => {
    const { template, context } = executionContext;
    const { name } = node.attributes;
    const displayBlock = getSynchronousTraceableMethod(template.displayBlock, node, template.source);
    return displayBlock(Object.assign(Object.assign({}, executionContext), { 
        // todo: was context: context.clone()
        // context: context.clone()
        context: new Map(context.entries()) }), name, true);
};

const executeUnaryNode = (node, executionContext) => {
    const { operand } = node.children;
    const { nodeExecutor: execute, template } = executionContext;
    switch (node.type) {
        case "negative": {
            return execute(operand, executionContext).then((value) => -(value));
        }
        case "not": {
            return execute(operand, executionContext).then((value) => !(value));
        }
        case "positive": {
            return execute(operand, executionContext).then((value) => +(value));
        }
    }
    return Promise.reject(createRuntimeError(`Unrecognized unary node of type "${node.type}"`, node, template.source));
};
const executeUnaryNodeSynchronously = (node, executionContext) => {
    const { operand } = node.children;
    const { nodeExecutor: execute, template } = executionContext;
    switch (node.type) {
        case "negative": {
            return -execute(operand, executionContext);
        }
        case "not": {
            return !execute(operand, executionContext);
        }
        case "positive": {
            return +execute(operand, executionContext);
        }
    }
    throw createRuntimeError(`Unrecognized unary node of type "${node.type}"`, node, template.source);
};

const createContext = (container = new Map()) => {
    const context = {
        get size() {
            return container.size;
        },
        [Symbol.iterator]: () => {
            return container[Symbol.iterator]();
        },
        clone: () => {
            const clonedContainer = new Map();
            for (const [key, value] of container) {
                clonedContainer.set(key, value);
            }
            return createContext(clonedContainer);
        },
        delete: (key) => {
            return container.delete(key);
        },
        entries: () => {
            return container.entries();
        },
        get: (key) => {
            return container.get(key);
        },
        has: (key) => {
            return container.has(key);
        },
        set: (key, value) => {
            container.set(key, value);
            return context;
        },
        values: () => {
            return container.values();
        }
    };
    return context;
};
const getEntries = (context) => {
    return Object.entries(context)[Symbol.iterator]();
};
const getValues = (context) => {
    return Object.values(context);
};

const executeArrayNode = async (baseNode, executionContext) => {
    const { nodeExecutor: execute } = executionContext;
    const keyValuePairs = getKeyValuePairs(baseNode);
    const array = [];
    for (const { value: valueNode } of keyValuePairs) {
        const value = await execute(valueNode, executionContext);
        if (valueNode.type === "spread") {
            array.push(...value);
        }
        else {
            array.push(value);
        }
    }
    return array;
};
const executeArrayNodeSynchronously = (baseNode, executionContext) => {
    const { nodeExecutor: execute } = executionContext;
    const keyValuePairs = getKeyValuePairs(baseNode);
    const array = [];
    for (const { value: valueNode } of keyValuePairs) {
        const value = execute(valueNode, executionContext);
        if (valueNode.type === "spread") {
            const values = getValues(value);
            array.push(...values);
        }
        else {
            array.push(value);
        }
    }
    return array;
};

const executeHashNode = async (node, executionContext) => {
    const { nodeExecutor: execute } = executionContext;
    const keyValuePairs = getKeyValuePairs(node);
    const hash = new Map();
    for (const { key: keyNode, value: valueNode } of keyValuePairs) {
        const [key, value] = await Promise.all([
            execute(keyNode, executionContext),
            execute(valueNode, executionContext)
        ]);
        if (valueNode.type === "spread") {
            for (const [valueKey, valueValue] of value) {
                hash.set(valueKey, valueValue);
            }
        }
        else {
            hash.set(key, value);
        }
    }
    return hash;
};
const executeHashNodeSynchronously = (node, executionContext) => {
    const { nodeExecutor: execute } = executionContext;
    const keyValuePairs = getKeyValuePairs(node);
    const hash = new Map();
    for (const { key: keyNode, value: valueNode } of keyValuePairs) {
        const key = execute(keyNode, executionContext);
        const value = execute(valueNode, executionContext);
        if (valueNode.type === "spread") {
            for (const [valueKey, valueValue] of getEntries(value)) {
                hash.set(valueKey, valueValue);
            }
        }
        else {
            hash.set(key, value);
        }
    }
    return hash;
};

const examineObject = (object) => {
    let properties = [];
    if (object) {
        for (const property of Object.getOwnPropertyNames(object)) {
            properties.push(property);
        }
        let prototype = Object.getPrototypeOf(object);
        properties = properties.concat(examineObject(prototype));
    }
    return properties;
};

/**
 * Return the value of a property of an object, providing array to Map conversion.
 *
 * @param {any} object
 * @param {any} property
 */
function get(object, property) {
    let result;
    if (isAMapLike(object) && object.has(property)) {
        result = object.get(property);
    }
    else {
        result = object[property];
    }
    if (Array.isArray(result)) {
        result = iteratorToMap(result);
    }
    return result;
}

function iteratorToHash(value) {
    let result;
    if (value.entries) {
        result = {};
        for (let entry of value.entries()) {
            result[entry[0]] = entry[1];
        }
        return result;
    }
    else {
        result = value;
    }
    return result;
}

/**
 * Count all elements in an object.
 *
 * @param {*} countable
 * @returns {number}
 */
const count = (countable) => {
    if (countable.size !== undefined) {
        return countable.size;
    }
    return Object.keys(countable).length;
};

const isBoolean = (candidate) => {
    return candidate === true || candidate === false;
};
const isFloat = (candidate) => {
    return +candidate === candidate && (!isFinite(candidate) || !!(candidate % 1));
};
/**
 * Adapted from https://github.com/kvz/locutus/blob/master/src/php/var/var_dump.js
 */
const varDump = (...args) => {
    let padChar = ' ';
    let padVal = 4;
    let length = 0;
    let getInnerVal = function _getInnerVal(val) {
        let result = '';
        if (val === null || typeof val === 'undefined') {
            result = 'NULL';
        }
        else if (typeof val === 'boolean') {
            result = 'bool(' + val + ')';
        }
        else if (typeof val === 'number') {
            if (parseFloat('' + val) === parseInt('' + val, 10)) {
                result = 'int(' + val + ')';
            }
            else {
                result = 'float(' + val + ')';
            }
        }
        else if (typeof val === 'function') {
            result = 'object(Closure) (0) {}';
        }
        else {
            result = 'string(' + val.length + ') "' + val + '"';
        }
        return result;
    };
    let formatArray = (obj, curDepth) => {
        if (isTraversable(obj)) {
            obj = iteratorToHash(obj);
        }
        let baseCount = padVal * (curDepth);
        let thickCount = padVal * (curDepth + 1);
        let basePad = padChar.repeat(baseCount);
        let thickPad = padChar.repeat(thickCount);
        let str = '';
        let val;
        if (typeof obj === 'object' && obj !== null) {
            length = count(obj);
            str += 'array(' + length + ') {\n';
            for (let key in obj) {
                let objVal = obj[key];
                if ((typeof objVal === 'object') && (objVal !== null) && !(objVal instanceof Date)) {
                    str += thickPad;
                    str += '[';
                    str += key;
                    str += '] =>\n';
                    str += thickPad;
                    str += formatArray(objVal, curDepth + 1);
                }
                else {
                    val = getInnerVal(objVal);
                    str += thickPad;
                    str += '[';
                    str += key;
                    str += '] =>\n';
                    str += thickPad;
                    str += val;
                    str += '\n';
                }
            }
            str += basePad + '}\n';
        }
        else {
            str = getInnerVal(obj) + '\n';
        }
        return str;
    };
    let output = [];
    for (let arg of args) {
        output.push(formatArray(arg, 0));
    }
    return output.join('');
};

/**
 * Returns the attribute value for a given array/object.
 *
 * @param environment
 * @param {*} object The object or array from where to get the item
 * @param {*} attribute The item to get from the array or object
 * @param {Map<any, any>} methodArguments A map of arguments to pass if the item is an object method
 * @param {string} type The type of attribute (@see Twig_Template constants)
 * @param {boolean} shouldTestExistence Whether this is only a defined check
 * @param {boolean} shouldIgnoreStrictCheck Whether to ignore the strict attribute check or not
 * @param sandboxed
 * @param strict
 *
 * @return {Promise<any>} The attribute value, or a boolean when isDefinedTest is true, or null when the attribute is not set and ignoreStrictCheck is true
 *
 * @throw {TwingErrorRuntime} if the attribute does not exist and Twing is running in strict mode and isDefinedTest is false
 */
const getAttribute = (environment, object, attribute, methodArguments, type, shouldTestExistence, shouldIgnoreStrictCheck, sandboxed, strict) => {
    const { sandboxPolicy } = environment;
    shouldIgnoreStrictCheck = (shouldIgnoreStrictCheck === null) ? !strict : shouldIgnoreStrictCheck;
    const _do = () => {
        let message;
        // ANY_CALL or ARRAY_CALL
        if (type !== "method") {
            let arrayItem;
            if (isBoolean(attribute)) {
                arrayItem = attribute ? 1 : 0;
            }
            else if (isFloat(attribute)) {
                arrayItem = parseInt(attribute);
            }
            else {
                arrayItem = attribute;
            }
            if (object) {
                if ((isAMapLike(object) && object.has(arrayItem))
                    || (Array.isArray(object) && (typeof arrayItem === "number") && (object.length > arrayItem))
                    || (isPlainObject(object) && Reflect.has(object, arrayItem))) {
                    if (shouldTestExistence) {
                        return true;
                    }
                    if (type !== "array" && sandboxed) {
                        sandboxPolicy.checkPropertyAllowed(object, attribute);
                    }
                    return get(object, arrayItem);
                }
            }
            if ((type === "array")
                || (isAMapLike(object))
                || (Array.isArray(object))
                || (object === null)
                || (typeof object !== 'object')) {
                if (shouldTestExistence) {
                    return false;
                }
                if (shouldIgnoreStrictCheck) {
                    return;
                }
                if (object === null) {
                    // object is null
                    if (type === "array") {
                        message = `Impossible to access a key ("${attribute}") on a null variable.`;
                    }
                    else {
                        message = `Impossible to access an attribute ("${attribute}") on a null variable.`;
                    }
                }
                else if (isAMapLike(object)) {
                    if (object.size < 1) {
                        message = `Index "${arrayItem}" is out of bounds as the array is empty.`;
                    }
                    else {
                        message = `Index "${arrayItem}" is out of bounds for array [${[...object.values()]}].`;
                    }
                }
                else if (Array.isArray(object)) {
                    if (object.length < 1) {
                        message = `Index "${arrayItem}" is out of bounds as the array is empty.`;
                    }
                    else {
                        message = `Index "${arrayItem}" is out of bounds for array [${[...object]}].`;
                    }
                }
                else if (type === "array") {
                    // object is another kind of object
                    message = `Impossible to access a key ("${attribute}") on a ${typeof object} variable ("${object.toString()}").`;
                }
                else {
                    // object is a primitive
                    message = `Impossible to access an attribute ("${attribute}") on a ${typeof object} variable ("${object}").`;
                }
                throw new Error(message);
            }
        }
        // ANY_CALL or METHOD_CALL
        if ((object === null) || (!isObject(object))) {
            if (shouldTestExistence) {
                return false;
            }
            if (shouldIgnoreStrictCheck) {
                return;
            }
            if (object === null) {
                message = `Impossible to invoke a method ("${attribute}") on a null variable.`;
            }
            else {
                message = `Impossible to invoke a method ("${attribute}") on a ${typeof object} variable ("${object}").`;
            }
            throw new Error(message);
        }
        // object property
        if (type !== "method") {
            if (Reflect.has(object, attribute) && (typeof object[attribute] !== 'function')) {
                if (shouldTestExistence) {
                    return true;
                }
                if (sandboxed) {
                    sandboxPolicy.checkPropertyAllowed(object, attribute);
                }
                return get(object, attribute);
            }
        }
        // object method
        // precedence: getXxx() > isXxx() > hasXxx()
        let methods = [];
        for (let property of examineObject(object)) {
            let candidate = object[property];
            if (typeof candidate === 'function') {
                methods.push(property);
            }
        }
        methods.sort();
        let lcMethods = methods.map((method) => {
            return method.toLowerCase();
        });
        let candidates = new Map();
        for (let i = 0; i < methods.length; i++) {
            let method = methods[i];
            let lcName = lcMethods[i];
            candidates.set(method, method);
            candidates.set(lcName, method);
            let name = '';
            if (lcName[0] === 'g' && lcName.indexOf('get') === 0) {
                name = method.substr(3);
                lcName = lcName.substr(3);
            }
            else if (lcName[0] === 'i' && lcName.indexOf('is') === 0) {
                name = method.substr(2);
                lcName = lcName.substr(2);
            }
            else if (lcName[0] === 'h' && lcName.indexOf('has') === 0) {
                name = method.substr(3);
                lcName = lcName.substr(3);
                if (lcMethods.includes('is' + lcName)) {
                    continue;
                }
            }
            else {
                continue;
            }
            // skip get() and is() methods (in which case, name is empty)
            if (name.length > 0) {
                if (!candidates.has(name)) {
                    candidates.set(name, method);
                }
                if (!candidates.has(lcName)) {
                    candidates.set(lcName, method);
                }
            }
        }
        let itemAsString = attribute;
        let method;
        let lcItem;
        if (candidates.has(attribute)) {
            method = candidates.get(attribute);
        }
        else if (candidates.has(lcItem = itemAsString.toLowerCase())) {
            method = candidates.get(lcItem);
        }
        else {
            if (shouldTestExistence) {
                return false;
            }
            if (shouldIgnoreStrictCheck) {
                return;
            }
            throw new Error(`Neither the property "${attribute}" nor one of the methods ${attribute}()" or "get${attribute}()"/"is${attribute}()"/"has${attribute}()" exist and have public access in class "${object.constructor.name}".`);
        }
        if (shouldTestExistence) {
            return true;
        }
        if (sandboxed) {
            sandboxPolicy.checkMethodAllowed(object, method);
        }
        return get(object, method).apply(object, [...methodArguments.values()]);
    };
    try {
        return Promise.resolve(_do());
    }
    catch (e) {
        return Promise.reject(e);
    }
};
const getAttributeSynchronously = (environment, object, attribute, methodArguments, type, shouldTestExistence, shouldIgnoreStrictCheck, sandboxed, strict) => {
    const { sandboxPolicy } = environment;
    shouldIgnoreStrictCheck = (shouldIgnoreStrictCheck === null) ? !strict : shouldIgnoreStrictCheck;
    let message;
    // ANY_CALL or ARRAY_CALL
    if (type !== "method") {
        let arrayItem;
        if (isBoolean(attribute)) {
            arrayItem = attribute ? 1 : 0;
        }
        else if (isFloat(attribute)) {
            arrayItem = parseInt(attribute);
        }
        else {
            arrayItem = attribute;
        }
        if (object) {
            if ((isAMapLike(object) && object.has(arrayItem))
                || (Array.isArray(object) && (typeof arrayItem === "number") && (object.length > arrayItem))
                || (isPlainObject(object) && Reflect.has(object, arrayItem))) {
                if (shouldTestExistence) {
                    return true;
                }
                if (type !== "array" && sandboxed) {
                    sandboxPolicy.checkPropertyAllowed(object, attribute);
                }
                return get(object, arrayItem);
            }
        }
        if ((type === "array")
            || (isAMapLike(object))
            || (Array.isArray(object))
            || (object === null)
            || (typeof object !== 'object')) {
            if (shouldTestExistence) {
                return false;
            }
            if (shouldIgnoreStrictCheck) {
                return;
            }
            if (object === null) {
                // object is null
                if (type === "array") {
                    message = `Impossible to access a key ("${attribute}") on a null variable.`;
                }
                else {
                    message = `Impossible to access an attribute ("${attribute}") on a null variable.`;
                }
            }
            else if (isAMapLike(object)) {
                if (object.size < 1) {
                    message = `Index "${arrayItem}" is out of bounds as the array is empty.`;
                }
                else {
                    message = `Index "${arrayItem}" is out of bounds for array [${[...object.values()]}].`;
                }
            }
            else if (Array.isArray(object)) {
                if (object.length < 1) {
                    message = `Index "${arrayItem}" is out of bounds as the array is empty.`;
                }
                else {
                    message = `Index "${arrayItem}" is out of bounds for array [${[...object]}].`;
                }
            }
            else if (type === "array") {
                // object is another kind of object
                message = `Impossible to access a key ("${attribute}") on a ${typeof object} variable ("${object.toString()}").`;
            }
            else {
                // object is a primitive
                message = `Impossible to access an attribute ("${attribute}") on a ${typeof object} variable ("${object}").`;
            }
            throw new Error(message);
        }
    }
    // ANY_CALL or METHOD_CALL
    if ((object === null) || (!isObject(object))) {
        if (shouldTestExistence) {
            return false;
        }
        if (shouldIgnoreStrictCheck) {
            return;
        }
        if (object === null) {
            message = `Impossible to invoke a method ("${attribute}") on a null variable.`;
        }
        else {
            message = `Impossible to invoke a method ("${attribute}") on a ${typeof object} variable ("${object}").`;
        }
        throw new Error(message);
    }
    // object property
    if (type !== "method") {
        if (Reflect.has(object, attribute) && (typeof object[attribute] !== 'function')) {
            if (shouldTestExistence) {
                return true;
            }
            if (sandboxed) {
                sandboxPolicy.checkPropertyAllowed(object, attribute);
            }
            return get(object, attribute);
        }
    }
    // object method
    // precedence: getXxx() > isXxx() > hasXxx()
    let methods = [];
    for (let property of examineObject(object)) {
        let candidate = object[property];
        if (typeof candidate === 'function') {
            methods.push(property);
        }
    }
    methods.sort();
    let lcMethods = methods.map((method) => {
        return method.toLowerCase();
    });
    let candidates = new Map();
    for (let i = 0; i < methods.length; i++) {
        let method = methods[i];
        let lcName = lcMethods[i];
        candidates.set(method, method);
        candidates.set(lcName, method);
        let name = '';
        if (lcName[0] === 'g' && lcName.indexOf('get') === 0) {
            name = method.substr(3);
            lcName = lcName.substr(3);
        }
        else if (lcName[0] === 'i' && lcName.indexOf('is') === 0) {
            name = method.substr(2);
            lcName = lcName.substr(2);
        }
        else if (lcName[0] === 'h' && lcName.indexOf('has') === 0) {
            name = method.substr(3);
            lcName = lcName.substr(3);
            if (lcMethods.includes('is' + lcName)) {
                continue;
            }
        }
        else {
            continue;
        }
        // skip get() and is() methods (in which case, name is empty)
        if (name.length > 0) {
            if (!candidates.has(name)) {
                candidates.set(name, method);
            }
            if (!candidates.has(lcName)) {
                candidates.set(lcName, method);
            }
        }
    }
    let itemAsString = attribute;
    let method;
    let lcItem;
    if (candidates.has(attribute)) {
        method = candidates.get(attribute);
    }
    else if (candidates.has(lcItem = itemAsString.toLowerCase())) {
        method = candidates.get(lcItem);
    }
    else {
        if (shouldTestExistence) {
            return false;
        }
        if (shouldIgnoreStrictCheck) {
            return;
        }
        throw new Error(`Neither the property "${attribute}" nor one of the methods ${attribute}()" or "get${attribute}()"/"is${attribute}()"/"has${attribute}()" exist and have public access in class "${object.constructor.name}".`);
    }
    if (shouldTestExistence) {
        return true;
    }
    if (sandboxed) {
        sandboxPolicy.checkMethodAllowed(object, method);
    }
    return get(object, method).apply(object, [...methodArguments.values()]);
};

const executeAttributeAccessorNode = (node, executionContext) => {
    const { template, sandboxed, environment, nodeExecutor: execute, strict } = executionContext;
    const { target, attribute, arguments: methodArguments } = node.children;
    const { type, shouldIgnoreStrictCheck, shouldTestExistence } = node.attributes;
    return Promise.all([
        execute(target, executionContext),
        execute(attribute, executionContext),
        execute(methodArguments, executionContext)
    ]).then(([target, attribute, methodArguments]) => {
        const traceableGetAttribute = getTraceableMethod(getAttribute, node, template.source);
        return traceableGetAttribute(environment, target, attribute, methodArguments, type, shouldTestExistence, shouldIgnoreStrictCheck || null, sandboxed, strict);
    });
};
const executeAttributeAccessorNodeSynchronously = (node, executionContext) => {
    const { template, sandboxed, environment, nodeExecutor: execute, strict } = executionContext;
    const { target: targetNode, attribute: attributeNode, arguments: argumentsNode } = node.children;
    const { type, shouldIgnoreStrictCheck, shouldTestExistence } = node.attributes;
    const target = execute(targetNode, executionContext);
    const attribute = execute(attributeNode, executionContext);
    const methodArguments = execute(argumentsNode, executionContext);
    const traceableGetAttribute = getSynchronousTraceableMethod(getAttributeSynchronously, node, template.source);
    return traceableGetAttribute(environment, target, attribute, methodArguments, type, shouldTestExistence, shouldIgnoreStrictCheck || null, sandboxed, strict);
};

const getContextValue = (charset, templateName, isStrictVariables, context, name, isAlwaysDefined, shouldIgnoreStrictCheck, shouldTestExistence) => {
    const specialNames = new Map([
        ['_self', templateName],
        ['_context', context],
        ['_charset', charset]
    ]);
    const isSpecial = () => {
        return specialNames.has(name);
    };
    let result;
    if (shouldTestExistence) {
        if (isSpecial()) {
            result = true;
        }
        else {
            result = context.get(name) !== undefined;
        }
    }
    else if (isSpecial()) {
        result = specialNames.get(name);
    }
    else if (isAlwaysDefined) {
        result = context.get(name);
    }
    else {
        if (shouldIgnoreStrictCheck || !isStrictVariables) {
            result = context.has(name) ? context.get(name) : null;
        }
        else {
            result = context.get(name);
            if (result === undefined) {
                return Promise.reject(new Error(`Variable "${name}" does not exist.`));
            }
        }
    }
    return Promise.resolve(result);
};
const getContextValueSynchronously = (charset, templateName, isStrictVariables, context, globals, name, isAlwaysDefined, shouldIgnoreStrictCheck, shouldTestExistence) => {
    const specialNames = new Map([
        ['_self', templateName],
        ['_context', context],
        ['_charset', charset]
    ]);
    const isSpecial = () => {
        return specialNames.has(name);
    };
    let result;
    if (shouldTestExistence) {
        if (isSpecial()) {
            result = true;
        }
        else {
            result = context.get(name) !== undefined || globals.get(name) !== undefined;
        }
    }
    else if (isSpecial()) {
        result = specialNames.get(name);
    }
    else if (isAlwaysDefined) {
        result = context.get(name);
        if (result === undefined) {
            result = globals.get(name);
        }
    }
    else {
        if (shouldIgnoreStrictCheck || !isStrictVariables) {
            result = context.has(name) ? context.get(name) : (globals.has(name) ? globals.get(name) : null);
        }
        else {
            result = context.get(name);
            if (result === undefined) {
                result = globals.get(name);
            }
            if (result === undefined) {
                throw new Error(`Variable "${name}" does not exist.`);
            }
        }
    }
    return result;
};

function mergeIterables(iterable1, iterable2) {
    let result = new Map();
    let index = 0;
    for (let [key, value] of iterable1) {
        if (typeof key === 'number') {
            key = index++;
        }
        result.set(key, value);
    }
    for (let [key, value] of iterable2) {
        if (typeof key === 'number') {
            key = index++;
        }
        result.set(key, value);
    }
    return result;
}

const executeNameNode = (node, { template, context, environment, strict }) => {
    const { name, isAlwaysDefined, shouldIgnoreStrictCheck, shouldTestExistence } = node.attributes;
    const traceableGetContextValue = getTraceableMethod(getContextValue, node, template.source);
    return traceableGetContextValue(environment.charset, template.name, strict, createContext(mergeIterables(environment.globals, context)), name, isAlwaysDefined, shouldIgnoreStrictCheck, shouldTestExistence);
};
const executeNameNodeSynchronously = (node, { template, context, environment, strict }) => {
    const { name, isAlwaysDefined, shouldIgnoreStrictCheck, shouldTestExistence } = node.attributes;
    const traceableGetContextValue = getSynchronousTraceableMethod(getContextValueSynchronously, node, template.source);
    return traceableGetContextValue(environment.charset, template.name, strict, 
    // todo: this is needed for the for loop to work properly when the sequence is the context, but this should not be needed
    new Map(context.entries()), environment.globals, name, isAlwaysDefined, shouldIgnoreStrictCheck, shouldTestExistence);
};

const executeSetNode = async (node, executionContext) => {
    const { context, nodeExecutor: execute, outputBuffer, sourceMapRuntime } = executionContext;
    const { names: namesNode, values: valuesNode } = node.children;
    const { captures } = node.attributes;
    const names = await execute(namesNode, executionContext);
    executionContext.sourceMapRuntime = undefined;
    if (captures) {
        outputBuffer.start();
        await execute(valuesNode, executionContext);
        const value = outputBuffer.getAndClean();
        for (const name of names) {
            context.set(name, value);
        }
    }
    else {
        const values = await execute(valuesNode, executionContext);
        let index = 0;
        for (const name of names) {
            const value = values[index];
            context.set(name, value);
            index++;
        }
    }
    executionContext.sourceMapRuntime = sourceMapRuntime;
};
const executeSetNodeSynchronously = (node, executionContext) => {
    const { context, nodeExecutor: execute, outputBuffer, sourceMapRuntime } = executionContext;
    const { names: namesNode, values: valuesNode } = node.children;
    const { captures } = node.attributes;
    const names = execute(namesNode, executionContext);
    executionContext.sourceMapRuntime = undefined;
    if (captures) {
        outputBuffer.start();
        execute(valuesNode, executionContext);
        const value = outputBuffer.getAndClean();
        for (const name of names) {
            context.set(name, value);
        }
    }
    else {
        const values = execute(valuesNode, executionContext);
        let index = 0;
        for (const name of names) {
            const value = values[index];
            context.set(name, value);
            index++;
        }
    }
    executionContext.sourceMapRuntime = sourceMapRuntime;
};

const evaluate = (value) => {
    if (value === '0'
        || (isAMapLike(value) && value.size === 0)
        || (Array.isArray(value) && value.length === 0)) {
        return false;
    }
    else if (Number.isNaN(value)) {
        return true;
    }
    else {
        return value;
    }
};

const executeIfNode = async (node, executionContext) => {
    const { tests: testsNode, else: elseNode } = node.children;
    const count = getChildrenCount(testsNode);
    const { nodeExecutor: execute } = executionContext;
    let index = 0;
    while (index < count) {
        const condition = testsNode.children[index];
        const conditionResult = await execute(condition, executionContext);
        if (evaluate(conditionResult)) {
            // the condition is satisfied, we execute the belonging body and return the result
            const body = testsNode.children[index + 1];
            return execute(body, executionContext);
        }
        index += 2;
    }
    if (elseNode !== undefined) {
        return execute(elseNode, executionContext);
    }
};
const executeIfNodeSynchronously = (node, executionContext) => {
    const { tests: testsNode, else: elseNode } = node.children;
    const count = getChildrenCount(testsNode);
    const { nodeExecutor: execute } = executionContext;
    let index = 0;
    while (index < count) {
        const condition = testsNode.children[index];
        const conditionResult = execute(condition, executionContext);
        if (evaluate(conditionResult)) {
            // the condition is satisfied, we execute the belonging body and return the result
            const body = testsNode.children[index + 1];
            return execute(body, executionContext);
        }
        index += 2;
    }
    if (elseNode !== undefined) {
        return execute(elseNode, executionContext);
    }
};

function ensureTraversable(seq) {
    if (isTraversable(seq) || isPlainObject(seq)) {
        return seq;
    }
    return [];
}

/**
 * Executes the provided function once for each element of an iterable.
 *
 * @param {*} iterable An iterable
 * @param {IterateCallback} callback Callback to execute for each element, taking a key and a value as arguments
 *
 * @return {void}
 */
const iterate = async (iterable, callback) => {
    if (iterable.entries) {
        for (const [key, value] of iterable.entries()) {
            await callback(key, value);
        }
    }
    else if (typeof iterable[Symbol.iterator] === 'function') {
        let i = 0;
        for (let value of iterable) {
            await callback(i++, value);
        }
    }
    else if (typeof iterable['next'] === 'function') {
        let i = 0;
        let next;
        while ((next = await iterable.next()) && !next.done) {
            await callback(i++, next.value);
        }
    }
    else {
        for (const key in iterable) {
            await callback(key, iterable[key]);
        }
    }
};
const iterateSynchronously = (iterable, callback) => {
    // todo: maybe useless when we pass records instead of TwingContext
    if (iterable.entries) {
        for (const [key, value] of iterable.entries()) {
            callback(key, value);
        }
    }
    else if (typeof iterable[Symbol.iterator] === 'function') {
        let i = 0;
        for (let value of iterable) {
            callback(i++, value);
        }
    }
    // todo: check why this is not covered anymore
    // else if (typeof iterable['next'] === 'function') {
    //     let i: number = 0;
    //     let next: any;
    //
    //     while ((next = iterable.next()) && !next.done) {
    //         callback(i++, next.value)
    //     }
    // }
    else {
        for (const key in iterable) {
            callback(key, iterable[key]);
        }
    }
};

const executeForNode = async (forNode, executionContext) => {
    const { context, nodeExecutor: execute } = executionContext;
    const { sequence: sequenceNode, body, else: elseNode, valueTarget: targetValueNode, keyTarget: targetKeyNode } = forNode.children;
    const { hasAnIf } = forNode.attributes;
    context.set('_parent', context.clone());
    const executedSequence = await execute(sequenceNode, executionContext);
    const sequence = ensureTraversable(executedSequence);
    context.set('_seq', sequence);
    if (elseNode) {
        context.set('_iterated', false);
    }
    context.set('loop', new Map([
        ['parent', context.get('_parent')],
        ['index0', 0],
        ['index', 1],
        ['first', true],
    ]));
    if (!hasAnIf) {
        const length = count(context.get('_seq'));
        const loop = context.get('loop');
        loop.set('revindex0', length - 1);
        loop.set('revindex', length);
        loop.set('length', length);
        loop.set('last', (length === 1));
    }
    const targetKey = await execute(targetKeyNode, executionContext);
    const targetValue = await execute(targetValueNode, executionContext);
    await iterate(context.get('_seq'), async (key, value) => {
        context.set(targetKey, key);
        context.set(targetValue, value);
        await execute(body, executionContext);
    });
    if (elseNode) {
        if (context.get('_iterated') === false) {
            await execute(elseNode, executionContext);
        }
    }
    const parent = context.get('_parent');
    context.delete('_seq');
    context.delete('_iterated');
    context.delete(targetKeyNode.attributes.name);
    context.delete(targetValueNode.attributes.name);
    context.delete('_parent');
    context.delete('loop');
    for (const [key, value] of parent) {
        if (!context.has(key)) {
            context.set(key, value);
        }
    }
};
const executeForNodeSynchronously = (forNode, executionContext) => {
    const { context, nodeExecutor: execute } = executionContext;
    const { sequence: sequenceNode, body, else: elseNode, valueTarget: targetValueNode, keyTarget: targetKeyNode } = forNode.children;
    const { hasAnIf } = forNode.attributes;
    context.set('_parent', new Map(context.entries()));
    const executedSequence = execute(sequenceNode, executionContext);
    const sequence = ensureTraversable(executedSequence);
    context.set('_seq', sequence);
    if (elseNode) {
        context.set('_iterated', false);
    }
    context.set('loop', new Map([
        ['parent', context.get('_parent')],
        ['index0', 0],
        ['index', 1],
        ['first', true],
    ]));
    if (!hasAnIf) {
        const length = count(context.get('_seq'));
        const loop = context.get('loop');
        loop.set('revindex0', length - 1);
        loop.set('revindex', length);
        loop.set('length', length);
        loop.set('last', (length === 1));
    }
    const targetKey = execute(targetKeyNode, executionContext);
    const targetValue = execute(targetValueNode, executionContext);
    iterateSynchronously(context.get('_seq'), (key, value) => {
        context.set(targetKey, key);
        // todo: @see https://github.com/twigphp/Twig/issues/4152
        if (key === '_parent') {
            context.set(targetValue, '[object Object]');
        }
        else {
            context.set(targetValue, value);
        }
        execute(body, executionContext);
    });
    if (elseNode) {
        if (context.get('_iterated') === false) {
            execute(elseNode, executionContext);
        }
    }
    const parent = context.get('_parent');
    context.delete('_seq');
    context.delete('_iterated');
    context.delete(targetKeyNode.attributes.name);
    context.delete(targetValueNode.attributes.name);
    context.delete('_parent');
    context.delete('loop');
    for (const [key, value] of parent) {
        if (!context.has(key)) {
            context.set(key, value);
        }
    }
};

const executeForLoopNode = (node, executionContext) => {
    const { hasAnElse, hasAnIf } = node.attributes;
    const { context } = executionContext;
    if (hasAnElse) {
        context.set('_iterated', true);
    }
    const loop = context.get('loop');
    loop.set('index0', loop.get('index0') + 1);
    loop.set('index', loop.get('index') + 1);
    loop.set('first', false);
    if (!hasAnIf && loop.has('length')) {
        loop.set('revindex0', loop.get('revindex0') - 1);
        loop.set('revindex', loop.get('revindex') - 1);
        loop.set('last', loop.get('revindex0') === 0);
    }
    return Promise.resolve();
};
const executeForLoopNodeSynchronously = (node, executionContext) => {
    const { hasAnElse, hasAnIf } = node.attributes;
    const { context } = executionContext;
    if (hasAnElse) {
        context.set('_iterated', true);
    }
    const loop = context.get('loop');
    loop.set('index0', loop.get('index0') + 1);
    loop.set('index', loop.get('index') + 1);
    loop.set('first', false);
    if (!hasAnIf && loop.has('length')) {
        loop.set('revindex0', loop.get('revindex0') - 1);
        loop.set('revindex', loop.get('revindex') - 1);
        loop.set('last', loop.get('revindex0') === 0);
    }
};

const executeCheckToStringNode = (node, executionContext) => {
    const { template, environment, nodeExecutor: execute, sandboxed } = executionContext;
    const { value: valueNode } = node.children;
    const { sandboxPolicy } = environment;
    return execute(valueNode, executionContext)
        .then((value) => {
        if (sandboxed) {
            const assertToStringAllowed = getTraceableMethod((value) => {
                if ((value !== null) && (typeof value === 'object')) {
                    try {
                        sandboxPolicy.checkMethodAllowed(value, 'toString');
                    }
                    catch (error) {
                        return Promise.reject(error);
                    }
                }
                return Promise.resolve(value);
            }, valueNode, template.source);
            return assertToStringAllowed(value);
        }
        return value;
    });
};
const executeCheckToStringNodeSynchronously = (node, executionContext) => {
    const { template, environment, nodeExecutor: execute, sandboxed } = executionContext;
    const { value: valueNode } = node.children;
    const { sandboxPolicy } = environment;
    const value = execute(valueNode, executionContext);
    if (sandboxed) {
        const assertToStringAllowed = getSynchronousTraceableMethod((value) => {
            if ((value !== null) && (typeof value === 'object')) {
                sandboxPolicy.checkMethodAllowed(value, 'toString');
            }
            return value;
        }, valueNode, template.source);
        return assertToStringAllowed(value);
    }
    return value;
};

const executeConditionalNode = async (node, executionContext) => {
    const { expr1, expr2, expr3 } = node.children;
    const { nodeExecutor: execute } = executionContext;
    return (await execute(expr1, executionContext)) ? execute(expr2, executionContext) : execute(expr3, executionContext);
};
const executeConditionalNodeSynchronously = (node, executionContext) => {
    const { expr1, expr2, expr3 } = node.children;
    const { nodeExecutor: execute } = executionContext;
    return (execute(expr1, executionContext)) ? execute(expr2, executionContext) : execute(expr3, executionContext);
};

const createOutputHandler = () => {
    let content = '';
    return {
        getContent: () => {
            return content;
        },
        write: (value) => {
            content = value;
        },
        append: (value) => {
            content += value;
        }
    };
};
const createOutputBuffer = () => {
    const handlers = [];
    const writables = [];
    const outputStream = {
        write: (chunk) => {
            writables.forEach((writable) => writable.write(chunk));
        },
        pipe: (writable) => {
            writables.push(writable);
        }
    };
    /**
     * Append the string to the top-most buffer or write it to the output stream if there is none
     *
     * @param {string} string | void
     */
    const outputWrite = (string) => {
        const active = getActive();
        if (active) {
            active.append(string);
        }
        else {
            outputStream.write(string);
        }
    };
    const getActive = () => {
        if (handlers.length > 0) {
            return handlers[handlers.length - 1];
        }
        else {
            return null;
        }
    };
    const outputBuffer = {
        get outputStream() {
            return outputStream;
        },
        clean: () => {
            const active = getActive();
            if (!active) {
                throw new Error('Failed to clean buffer: no buffer to clean.');
            }
            active.write('');
            return true;
        },
        echo(value) {
            if (typeof value === 'boolean') {
                value = (value === true) ? '1' : '';
            }
            else if (typeof value === "number") {
                value = String(value);
            }
            else if (value === null || value === undefined) {
                value = '';
            }
            return outputWrite(value);
        },
        endAndClean: () => {
            outputBuffer.clean();
            handlers.pop();
            return true;
        },
        endAndFlush: () => {
            if (!getActive()) {
                throw new Error('Failed to delete and flush buffer: no buffer to delete or flush.');
            }
            outputBuffer.flush();
            handlers.pop();
            return true;
        },
        flush: () => {
            let active = getActive();
            if (!active) {
                throw new Error('Failed to flush buffer: no buffer to flush.');
            }
            handlers.pop();
            outputWrite(active.getContent());
            active.write('');
            handlers.push(active);
            return true;
        },
        getAndClean: () => {
            const content = outputBuffer.getContents();
            outputBuffer.endAndClean();
            return content;
        },
        getAndFlush: () => {
            const content = outputBuffer.getContents();
            outputBuffer.endAndFlush();
            return content;
        },
        getContents: () => {
            const activeOutputHandler = getActive();
            return activeOutputHandler ? activeOutputHandler.getContent() : '';
        },
        getLevel: () => {
            return handlers.length;
        },
        start: () => {
            const handler = createOutputHandler();
            handlers.push(handler);
            return true;
        }
    };
    return outputBuffer;
};

/**
 * Clone a map.
 *
 * @param {Map<K, V>} map
 * @returns {Map<K, V>}
 */
function cloneMap(map) {
    let result = new Map();
    for (let [key, value] of map) {
        result.set(key, value);
    }
    return result;
}

const createTemplateLoader = (environment) => {
    const registry = new Map();
    return async (name, from) => {
        const { loader } = environment;
        let templateFqn = await loader.resolve(name, from) || name;
        let loadedTemplate = registry.get(templateFqn);
        if (loadedTemplate) {
            return Promise.resolve(loadedTemplate);
        }
        else {
            const { cache } = environment;
            const timestamp = cache ? await cache.getTimestamp(templateFqn) : 0;
            const getAstFromCache = async () => {
                if (cache === null) {
                    return Promise.resolve(null);
                }
                let content;
                const isFresh = await loader.isFresh(name, timestamp, from);
                if (isFresh) {
                    content = await cache.load(templateFqn);
                }
                else {
                    content = null;
                }
                return content;
            };
            const getAstFromLoader = async () => {
                const source = await loader.getSource(name, from);
                if (source === null) {
                    return null;
                }
                const ast = environment.parse(environment.tokenize(source));
                if (cache !== null) {
                    await cache.write(templateFqn, ast);
                }
                return ast;
            };
            let ast = await getAstFromCache();
            if (ast === null) {
                ast = await getAstFromLoader();
            }
            if (ast === null) {
                return null;
            }
            const template = createTemplate(ast);
            registry.set(templateFqn, template);
            return template;
        }
    };
};
const createSynchronousTemplateLoader = (environment) => {
    const registry = new Map();
    return (name, from) => {
        const { loader } = environment;
        let templateFqn = loader.resolve(name, from) || name;
        let loadedTemplate = registry.get(templateFqn);
        if (loadedTemplate) {
            return loadedTemplate;
        }
        else {
            const { cache } = environment;
            const timestamp = cache ? cache.getTimestamp(templateFqn) : 0;
            const getAstFromCache = () => {
                if (cache === null) {
                    return null;
                }
                let content;
                const isFresh = loader.isFresh(name, timestamp, from);
                if (isFresh) {
                    content = cache.load(templateFqn);
                }
                else {
                    content = null;
                }
                return content;
            };
            const getAstFromLoader = () => {
                const source = loader.getSource(name, from);
                if (source === null) {
                    return null;
                }
                const ast = environment.parse(environment.tokenize(source));
                if (cache !== null) {
                    cache.write(templateFqn, ast);
                }
                return ast;
            };
            let ast = getAstFromCache();
            if (ast === null) {
                ast = getAstFromLoader();
            }
            if (ast === null) {
                return null;
            }
            const template = createSynchronousTemplate(ast);
            registry.set(templateFqn, template);
            return template;
        }
    };
};

const executeSynchronousTemplate = (template, runtime, context, blocks, outputBuffer, options) => {
    const aliases = Object.assign({}, template.aliases);
    const nodeExecutor = (options === null || options === void 0 ? void 0 : options.nodeExecutor) || executeNodeSynchronously;
    const sandboxed = (options === null || options === void 0 ? void 0 : options.sandboxed) || false;
    const sourceMapRuntime = options === null || options === void 0 ? void 0 : options.sourceMapRuntime;
    const templateLoader = (options === null || options === void 0 ? void 0 : options.templateLoader) || createSynchronousTemplateLoader(runtime);
    const executionContext = {
        aliases,
        blocks: new Map(),
        context,
        environment: runtime,
        nodeExecutor,
        outputBuffer,
        sandboxed,
        sourceMapRuntime,
        strict: (options === null || options === void 0 ? void 0 : options.strict) || false,
        template,
        templateLoader
    };
    const parent = template.getParent(executionContext);
    const ownBlocks = template.getBlocks(executionContext);
    blocks = mergeIterables(ownBlocks, blocks);
    nodeExecutor(template.ast, Object.assign(Object.assign({}, executionContext), { blocks }));
    if (parent) {
        return executeSynchronousTemplate(parent, runtime, context, blocks, outputBuffer, options);
    }
};
const renderSynchronousTemplate = (template, runtime, context, options) => {
    const outputBuffer = (options === null || options === void 0 ? void 0 : options.outputBuffer) || createOutputBuffer();
    outputBuffer.start();
    executeSynchronousTemplate(template, runtime, context, new Map(), outputBuffer, options);
    return outputBuffer.getAndFlush();
};
const createTemplate = (ast) => {
    // blocks
    const blockHandlers = new Map();
    let blocks = null;
    const { blocks: blockNodes } = ast.children;
    for (const [name, blockNode] of getChildren(blockNodes)) {
        const blockHandler = (executionContent) => {
            const aliases = template.aliases.clone();
            return executionContent.nodeExecutor(blockNode.children.body, Object.assign(Object.assign({}, executionContent), { aliases,
                template }));
        };
        blockHandlers.set(name, blockHandler);
    }
    // macros
    const macroHandlers = new Map();
    const { macros: macrosNode } = ast.children;
    for (const [name, macroNode] of Object.entries(macrosNode.children)) {
        const macroHandler = async (executionContent, ...args) => {
            const { environment, nodeExecutor, outputBuffer } = executionContent;
            const { body, arguments: macroArguments } = macroNode.children;
            const keyValuePairs = getKeyValuePairs(macroArguments);
            const aliases = template.aliases.clone();
            const localVariables = new Map();
            for (const { key: keyNode, value: defaultValueNode } of keyValuePairs) {
                const key = keyNode.attributes.value;
                const defaultValue = await nodeExecutor(defaultValueNode, Object.assign(Object.assign({}, executionContent), { aliases, blocks: new Map(), context: createContext() }));
                let value = args.shift();
                if (value === undefined) {
                    value = defaultValue;
                }
                localVariables.set(key, value);
            }
            localVariables.set('varargs', args);
            const context = createContext(localVariables);
            const blocks = new Map();
            outputBuffer.start();
            return await nodeExecutor(body, Object.assign(Object.assign({}, executionContent), { aliases,
                blocks,
                context,
                template }))
                .then(() => {
                const content = outputBuffer.getContents();
                return createMarkup(content, environment.charset);
            })
                .finally(() => {
                outputBuffer.endAndClean();
            });
        };
        macroHandlers.set(name, macroHandler);
    }
    // traits
    let traits = null;
    // embedded templates
    const embeddedTemplates = new Map();
    for (const embeddedTemplate of ast.embeddedTemplates) {
        embeddedTemplates.set(embeddedTemplate.attributes.index, createTemplate(embeddedTemplate));
    }
    // parent
    let parent = null;
    // A template can be used as a trait if:
    //   * it has no parent
    //   * it has no macros
    //   * it has no body
    //
    // Put another way, a template can be used as a trait if it
    // only contains blocks and use statements.
    const { parent: parentNode, macros, body } = ast.children;
    const { line, column } = ast;
    let canBeUsedAsATrait = (parentNode === undefined) && (getChildrenCount(macros) === 0);
    if (canBeUsedAsATrait) {
        let node = body;
        if (getChildrenCount(body) === 0) {
            node = createNode({ body }, line, column);
        }
        for (const [, child] of Object.entries(node.children)) {
            if (getChildrenCount(child) === 0) {
                continue;
            }
            canBeUsedAsATrait = false;
            break;
        }
    }
    /**
     * Tries to load templates consecutively from an array.
     *
     * Similar to loadTemplate() but it also accepts instances of TwingTemplate and an array of templates where each is tried to be loaded.
     *
     * @param executionContext
     * @param names A template or an array of templates to try consecutively
     */
    const resolveTemplate = (executionContext, names) => {
        const loadTemplateAtIndex = (index) => {
            if (index < names.length) {
                const name = names[index];
                if (name === null) {
                    return loadTemplateAtIndex(index + 1);
                }
                else if (typeof name !== "string") {
                    return Promise.resolve(name);
                }
                else {
                    return template.loadTemplate(executionContext, name)
                        .catch((error) => {
                        if (error.name === "TwingParsingError") {
                            return Promise.reject(error);
                        }
                        return loadTemplateAtIndex(index + 1);
                    });
                }
            }
            else {
                // todo: use traceable method?
                return Promise.reject(createTemplateLoadingError(names.map((name) => {
                    if (name === null) {
                        return '';
                    }
                    return name;
                })));
            }
        };
        return loadTemplateAtIndex(0);
    };
    const template = {
        get aliases() {
            return aliases;
        },
        get ast() {
            return ast;
        },
        get blockHandlers() {
            return blockHandlers;
        },
        get canBeUsedAsATrait() {
            return canBeUsedAsATrait;
        },
        get embeddedTemplates() {
            return embeddedTemplates;
        },
        get macroHandlers() {
            return macroHandlers;
        },
        get name() {
            return template.source.name;
        },
        get source() {
            return ast.attributes.source;
        },
        displayBlock: (executionContext, name, useBlocks) => {
            const { blocks } = executionContext;
            return template.getBlocks(executionContext)
                .then((ownBlocks) => {
                let blockHandler;
                let block;
                if (useBlocks && (block = blocks.get(name)) !== undefined) {
                    const [blockTemplate, blockName] = block;
                    blockHandler = blockTemplate.blockHandlers.get(blockName);
                }
                else if ((block = ownBlocks.get(name)) !== undefined) {
                    const [blockTemplate, blockName] = block;
                    blockHandler = blockTemplate.blockHandlers.get(blockName);
                }
                if (blockHandler) {
                    return blockHandler(executionContext);
                }
                else {
                    return template.getParent(executionContext).then((parent) => {
                        if (parent) {
                            return parent.displayBlock(executionContext, name, false);
                        }
                        else {
                            const block = blocks.get(name);
                            if (block) {
                                const [blockTemplate] = block;
                                throw new Error(`Block "${name}" should not call parent() in "${blockTemplate.name}" as the block does not exist in the parent template "${template.name}".`);
                            }
                            else {
                                throw new Error(`Block "${name}" on template "${template.name}" does not exist.`);
                            }
                        }
                    });
                }
            });
        },
        displayParentBlock: (executionContext, name) => {
            return template.getTraits(executionContext)
                .then((traits) => {
                const trait = traits.get(name);
                if (trait) {
                    const [blockTemplate, blockName] = trait;
                    return blockTemplate.displayBlock(executionContext, blockName, false);
                }
                else {
                    return template.getParent(executionContext)
                        .then((parent) => {
                        if (parent !== null) {
                            return parent.displayBlock(executionContext, name, false);
                        }
                        else {
                            throw new Error(`The template has no parent and no traits defining the "${name}" block.`);
                        }
                    });
                }
            });
        },
        execute: async (environment, context, blocks, outputBuffer, options) => {
            const aliases = template.aliases.clone();
            const nodeExecutor = (options === null || options === void 0 ? void 0 : options.nodeExecutor) || executeNode;
            const sandboxed = (options === null || options === void 0 ? void 0 : options.sandboxed) || false;
            const sourceMapRuntime = options === null || options === void 0 ? void 0 : options.sourceMapRuntime;
            const templateLoader = (options === null || options === void 0 ? void 0 : options.templateLoader) || createTemplateLoader(environment);
            const executionContext = {
                aliases,
                blocks: new Map(),
                context,
                environment,
                nodeExecutor,
                outputBuffer,
                sandboxed,
                sourceMapRuntime,
                strict: (options === null || options === void 0 ? void 0 : options.strict) || false,
                template,
                templateLoader
            };
            return Promise.all([
                template.getParent(executionContext),
                template.getBlocks(executionContext)
            ]).then(([parent, ownBlocks]) => {
                blocks = mergeIterables(ownBlocks, blocks);
                return nodeExecutor(ast, Object.assign(Object.assign({}, executionContext), { blocks })).then(() => {
                    if (parent) {
                        return parent.execute(environment, context, blocks, outputBuffer, options);
                    }
                });
            });
        },
        getBlocks: (executionContext) => {
            if (blocks) {
                return Promise.resolve(blocks);
            }
            else {
                return template.getTraits(executionContext)
                    .then((traits) => {
                    blocks = mergeIterables(traits, new Map([...blockHandlers.keys()].map((key) => {
                        return [key, [template, key]];
                    })));
                    return blocks;
                });
            }
        },
        getParent: async (executionContext) => {
            if (parent !== null) {
                return Promise.resolve(parent);
            }
            const parentNode = ast.children.parent;
            if (parentNode) {
                const { nodeExecutor } = executionContext;
                return template.getBlocks(executionContext)
                    .then(async (blocks) => {
                    const parentName = await nodeExecutor(parentNode, Object.assign(Object.assign({}, executionContext), { aliases: createContext(), blocks }));
                    const loadTemplate = getTraceableMethod(template.loadTemplate, parentNode, template.source);
                    const loadedParent = await loadTemplate(executionContext, parentName);
                    if (parentNode.type === "constant") {
                        parent = loadedParent;
                    }
                    return loadedParent;
                });
            }
            else {
                return Promise.resolve(null);
            }
        },
        getTraits: async (executionContext) => {
            if (traits === null) {
                traits = new Map();
                const { traits: traitsNode } = ast.children;
                for (const [, traitNode] of getChildren(traitsNode)) {
                    const { template: templateNameNode, targets } = traitNode.children;
                    const templateName = templateNameNode.attributes.value;
                    const loadTemplate = getTraceableMethod(template.loadTemplate, templateNameNode, template.source);
                    const traitTemplate = await loadTemplate(executionContext, templateName);
                    if (!traitTemplate.canBeUsedAsATrait) {
                        throw createRuntimeError(`Template ${templateName} cannot be used as a trait.`, templateNameNode, template.source);
                    }
                    const traitBlocks = cloneMap(await traitTemplate.getBlocks(executionContext));
                    for (const [key, target] of getChildren(targets)) {
                        const traitBlock = traitBlocks.get(key);
                        if (!traitBlock) {
                            throw createRuntimeError(`Block "${key}" is not defined in trait "${templateName}".`, templateNameNode, template.source);
                        }
                        const targetValue = target.attributes.value;
                        traitBlocks.set(targetValue, traitBlock);
                        traitBlocks.delete(key);
                    }
                    traits = mergeIterables(traits, traitBlocks);
                }
            }
            return Promise.resolve(traits);
        },
        hasBlock: (executionContext, name, blocks) => {
            if (blocks.has(name)) {
                return Promise.resolve(true);
            }
            else {
                return template.getBlocks(executionContext)
                    .then((blocks) => {
                    if (blocks.has(name)) {
                        return Promise.resolve(true);
                    }
                    else {
                        return template.getParent(executionContext)
                            .then((parent) => {
                            if (parent) {
                                return parent.hasBlock(executionContext, name, blocks);
                            }
                            else {
                                return false;
                            }
                        });
                    }
                });
            }
        },
        hasMacro: (name) => {
            // @see https://github.com/twigphp/Twig/issues/3174 as to why we don't check macro existence in parents
            return Promise.resolve(template.macroHandlers.has(name));
        },
        loadTemplate: (executionContext, identifier) => {
            let promise;
            if (typeof identifier === "string") {
                promise = executionContext.templateLoader(identifier, template.name)
                    .then((template) => {
                    if (template === null) {
                        throw createTemplateLoadingError([identifier]);
                    }
                    return template;
                });
            }
            else if (Array.isArray(identifier)) {
                promise = resolveTemplate(executionContext, identifier);
            }
            else {
                promise = Promise.resolve(identifier);
            }
            return promise;
        },
        render: (environment, context, options) => {
            const outputBuffer = (options === null || options === void 0 ? void 0 : options.outputBuffer) || createOutputBuffer();
            outputBuffer.start();
            return template.execute(environment, createContext(iteratorToMap(context)), new Map(), outputBuffer, options).then(() => {
                return outputBuffer.getAndFlush();
            });
        }
    };
    const aliases = createContext();
    aliases.set(`_self`, template);
    return template;
};
const createSynchronousTemplate = (ast) => {
    // blocks
    const blockHandlers = new Map();
    let blocks = null;
    const { blocks: blockNodes } = ast.children;
    for (const [name, blockNode] of getChildren(blockNodes)) {
        const blockHandler = (executionContent) => {
            const aliases = Object.assign({}, template.aliases);
            return executionContent.nodeExecutor(blockNode.children.body, Object.assign(Object.assign({}, executionContent), { aliases,
                template }));
        };
        blockHandlers.set(name, blockHandler);
    }
    // macros
    const macroHandlers = new Map();
    const { macros: macrosNode } = ast.children;
    for (const [name, macroNode] of Object.entries(macrosNode.children)) {
        const macroHandler = (executionContent, ...args) => {
            const { environment, nodeExecutor, outputBuffer } = executionContent;
            const { body, arguments: macroArguments } = macroNode.children;
            const keyValuePairs = getKeyValuePairs(macroArguments);
            const aliases = Object.assign({}, template.aliases);
            const localVariables = new Map();
            for (const { key: keyNode, value: defaultValueNode } of keyValuePairs) {
                const key = keyNode.attributes.value;
                const defaultValue = nodeExecutor(defaultValueNode, Object.assign(Object.assign({}, executionContent), { aliases, blocks: new Map(), context: new Map() }));
                let value = args.shift();
                if (value === undefined) {
                    value = defaultValue;
                }
                localVariables.set(key, value);
            }
            localVariables.set('varargs', args);
            const context = localVariables;
            const blocks = new Map();
            outputBuffer.start();
            try {
                nodeExecutor(body, Object.assign(Object.assign({}, executionContent), { aliases,
                    blocks,
                    context,
                    template }));
                const content = outputBuffer.getContents();
                return createMarkup(content, environment.charset);
            }
            finally {
                outputBuffer.endAndClean();
            }
        };
        macroHandlers.set(name, macroHandler);
    }
    // traits
    let traits = null;
    // embedded templates
    const embeddedTemplates = new Map();
    for (const embeddedTemplate of ast.embeddedTemplates) {
        embeddedTemplates.set(embeddedTemplate.attributes.index, createSynchronousTemplate(embeddedTemplate));
    }
    // parent
    let parent = null;
    // A template can be used as a trait if:
    //   * it has no parent
    //   * it has no macros
    //   * it has no body
    //
    // Put another way, a template can be used as a trait if it
    // only contains blocks and use statements.
    const { parent: parentNode, macros, body } = ast.children;
    const { line, column } = ast;
    let canBeUsedAsATrait = (parentNode === undefined) && (getChildrenCount(macros) === 0);
    if (canBeUsedAsATrait) {
        let node = body;
        if (getChildrenCount(body) === 0) {
            node = createNode({ body }, line, column);
        }
        for (const [, child] of Object.entries(node.children)) {
            if (getChildrenCount(child) === 0) {
                continue;
            }
            canBeUsedAsATrait = false;
            break;
        }
    }
    /**
     * Tries to load templates consecutively from an array.
     *
     * Similar to loadTemplate() but it also accepts instances of TwingTemplate and an array of templates where each is tried to be loaded.
     *
     * @param executionContext
     * @param names A template or an array of templates to try consecutively
     */
    const resolveTemplate = (executionContext, names) => {
        const loadTemplateAtIndex = (index) => {
            if (index < names.length) {
                const name = names[index];
                if (name === null) {
                    return loadTemplateAtIndex(index + 1);
                }
                else if (typeof name !== "string") {
                    return name;
                }
                else {
                    try {
                        return template.loadTemplate(executionContext, name);
                    }
                    catch (error) {
                        if (error.name === "TwingParsingError") {
                            throw error;
                        }
                        return loadTemplateAtIndex(index + 1);
                    }
                }
            }
            else {
                throw createTemplateLoadingError(names.map((name) => {
                    if (name === null) {
                        return '';
                    }
                    return name;
                }));
            }
        };
        return loadTemplateAtIndex(0);
    };
    const template = {
        get aliases() {
            return aliases;
        },
        get ast() {
            return ast;
        },
        get blockHandlers() {
            return blockHandlers;
        },
        get canBeUsedAsATrait() {
            return canBeUsedAsATrait;
        },
        get embeddedTemplates() {
            return embeddedTemplates;
        },
        get macroHandlers() {
            return macroHandlers;
        },
        get name() {
            return template.source.name;
        },
        get source() {
            return ast.attributes.source;
        },
        displayBlock: (executionContext, name, useBlocks) => {
            const { blocks } = executionContext;
            const ownBlocks = template.getBlocks(executionContext);
            let blockHandler;
            let block;
            if (useBlocks && (block = blocks.get(name)) !== undefined) {
                const [blockTemplate, blockName] = block;
                blockHandler = blockTemplate.blockHandlers.get(blockName);
            }
            else if ((block = ownBlocks.get(name)) !== undefined) {
                const [blockTemplate, blockName] = block;
                blockHandler = blockTemplate.blockHandlers.get(blockName);
            }
            if (blockHandler) {
                return blockHandler(executionContext);
            }
            else {
                const parent = template.getParent(executionContext);
                if (parent) {
                    return parent.displayBlock(executionContext, name, false);
                }
                else {
                    const block = blocks.get(name);
                    if (block) {
                        const [blockTemplate] = block;
                        throw new Error(`Block "${name}" should not call parent() in "${blockTemplate.name}" as the block does not exist in the parent template "${template.name}".`);
                    }
                    else {
                        throw new Error(`Block "${name}" on template "${template.name}" does not exist.`);
                    }
                }
            }
        },
        displayParentBlock: (executionContext, name) => {
            const traits = template.getTraits(executionContext);
            const trait = traits.get(name);
            if (trait) {
                const [blockTemplate, blockName] = trait;
                return blockTemplate.displayBlock(executionContext, blockName, false);
            }
            else {
                const parent = template.getParent(executionContext);
                if (parent !== null) {
                    return parent.displayBlock(executionContext, name, false);
                }
                else {
                    throw new Error(`The template has no parent and no traits defining the "${name}" block.`);
                }
            }
        },
        execute: (environment, context, blocks, outputBuffer, options) => {
            return executeSynchronousTemplate(template, environment, isAMapLike(context) ? context : iterableToMap(context), blocks, outputBuffer, options);
        },
        getBlocks: (executionContext) => {
            if (blocks !== null) {
                return blocks;
            }
            const traits = template.getTraits(executionContext);
            blocks = mergeIterables(traits, new Map([...blockHandlers.keys()].map((key) => {
                return [key, [template, key]];
            })));
            return blocks;
        },
        getParent: (executionContext) => {
            if (parent !== null) {
                return parent;
            }
            const parentNode = ast.children.parent;
            if (parentNode) {
                const { nodeExecutor } = executionContext;
                const blocks = template.getBlocks(executionContext);
                const parentName = nodeExecutor(parentNode, Object.assign(Object.assign({}, executionContext), { aliases: {}, blocks }));
                const loadTemplate = getSynchronousTraceableMethod(template.loadTemplate, parentNode, template.source);
                const loadedParent = loadTemplate(executionContext, parentName);
                if (parentNode.type === "constant") {
                    parent = loadedParent;
                }
                return loadedParent;
            }
            else {
                return null;
            }
        },
        getTraits: (executionContext) => {
            if (traits === null) {
                traits = new Map();
                const { traits: traitsNode } = ast.children;
                for (const [, traitNode] of getChildren(traitsNode)) {
                    const { template: templateNameNode, targets } = traitNode.children;
                    const templateName = templateNameNode.attributes.value;
                    const loadTemplate = getSynchronousTraceableMethod(template.loadTemplate, templateNameNode, template.source);
                    const traitTemplate = loadTemplate(executionContext, templateName);
                    if (!traitTemplate.canBeUsedAsATrait) {
                        throw createRuntimeError(`Template ${templateName} cannot be used as a trait.`, templateNameNode, template.source);
                    }
                    const traitBlocks = cloneMap(traitTemplate.getBlocks(executionContext));
                    for (const [key, target] of getChildren(targets)) {
                        const traitBlock = traitBlocks.get(key);
                        if (!traitBlock) {
                            throw createRuntimeError(`Block "${key}" is not defined in trait "${templateName}".`, templateNameNode, template.source);
                        }
                        const targetValue = target.attributes.value;
                        traitBlocks.set(targetValue, traitBlock);
                        traitBlocks.delete(key);
                    }
                    traits = mergeIterables(traits, traitBlocks);
                }
            }
            return traits;
        },
        hasBlock: (executionContext, name, blocks) => {
            if (blocks.has(name)) {
                return true;
            }
            else {
                const blocks = template.getBlocks(executionContext);
                if (blocks.has(name)) {
                    return true;
                }
                else {
                    const parent = template.getParent(executionContext);
                    if (parent) {
                        return parent.hasBlock(executionContext, name, blocks);
                    }
                    else {
                        return false;
                    }
                }
            }
        },
        hasMacro: (name) => {
            // @see https://github.com/twigphp/Twig/issues/3174 as to why we don't check macro existence in parents
            return template.macroHandlers.has(name);
        },
        loadTemplate: (executionContext, identifier) => {
            if (typeof identifier === "string") {
                const loadedTemplate = executionContext.templateLoader(identifier, template.name);
                if (loadedTemplate === null) {
                    throw createTemplateLoadingError([identifier]);
                }
                return loadedTemplate;
            }
            else if (Array.isArray(identifier)) {
                return resolveTemplate(executionContext, identifier);
            }
            else {
                return identifier;
            }
        },
        render: (environment, context, options) => {
            return renderSynchronousTemplate(template, environment, isAMapLike(context) ? context : iterableToMap(context), options);
        }
    };
    const aliases = {};
    aliases[`_self`] = template;
    return template;
};

/**
 * Renders a template.
 *
 * @param executionContext
 * @param templates The template to render or an array of templates to try consecutively
 * @param variables The variables to pass to the template
 * @param withContext
 * @param ignoreMissing Whether to ignore missing templates or not
 * @param sandboxed
 *
 * @returns {Promise<TwingMarkup>} The rendered template
 */
const include = (executionContext, templates, variables, withContext, ignoreMissing, sandboxed) => {
    const { template, environment, templateLoader, context, nodeExecutor, outputBuffer, sourceMapRuntime, strict } = executionContext;
    if (!isPlainObject(variables) && !isTraversable(variables)) {
        const isVariablesNullOrUndefined = variables === null || variables === undefined;
        return Promise.reject(new Error(`Variables passed to the "include" function or tag must be iterable, got "${!isVariablesNullOrUndefined ? typeof variables : variables}".`));
    }
    variables = iteratorToMap(variables);
    if (withContext) {
        variables = mergeIterables(context, variables);
    }
    if (!Array.isArray(templates)) {
        templates = [templates];
    }
    const resolveTemplate = (templates) => {
        return template.loadTemplate(executionContext, templates)
            .catch((error) => {
            if (error.name === "TwingParsingError") {
                throw error;
            }
            if (!ignoreMissing) {
                throw error;
            }
            else {
                return null;
            }
        });
    };
    return resolveTemplate(templates)
        .then((template) => {
        outputBuffer.start();
        if (template) {
            return template.execute(environment, createContext(iterableToMap(variables)), new Map(), outputBuffer, {
                nodeExecutor,
                sandboxed,
                sourceMapRuntime: sourceMapRuntime || undefined,
                strict,
                templateLoader
            });
        }
        else {
            return Promise.resolve();
        }
    })
        .then(() => {
        const result = outputBuffer.getAndClean();
        return createMarkup(result, environment.charset);
    });
};
const includeSynchronously = (executionContext, templates, variables, withContext, ignoreMissing, sandboxed) => {
    const { template, environment, templateLoader, context, nodeExecutor, outputBuffer, sourceMapRuntime, strict } = executionContext;
    if (!isPlainObject(variables) && !isTraversable(variables)) {
        const isVariablesNullOrUndefined = variables === null || variables === undefined;
        throw new Error(`Variables passed to the "include" function or tag must be iterable, got "${!isVariablesNullOrUndefined ? typeof variables : variables}".`);
    }
    variables = iteratorToMap(variables);
    if (withContext) {
        variables = new Map([
            ...context.entries(),
            ...variables.entries()
        ]);
    }
    if (!Array.isArray(templates)) {
        templates = [templates];
    }
    const resolveTemplate = (templates) => {
        try {
            return template.loadTemplate(executionContext, templates);
        }
        catch (error) {
            if (error.name === "TwingParsingError") {
                throw error;
            }
            if (!ignoreMissing) {
                throw error;
            }
            else {
                return null;
            }
        }
    };
    const resolvedTemplate = resolveTemplate(templates);
    outputBuffer.start();
    if (resolvedTemplate) {
        executeSynchronousTemplate(resolvedTemplate, environment, variables, new Map(), outputBuffer, {
            nodeExecutor,
            sandboxed,
            sourceMapRuntime: sourceMapRuntime || undefined,
            strict,
            templateLoader
        });
    }
    const result = outputBuffer.getAndClean();
    return createMarkup(result, environment.charset);
};

const executeBaseIncludeNode = async (node, executionContext, getTemplate) => {
    const { nodeExecutor: execute, outputBuffer, sandboxed, template } = executionContext;
    const { variables } = node.children;
    const { only, ignoreMissing } = node.attributes;
    const templatesToInclude = await getTemplate(executionContext);
    const traceableInclude = getTraceableMethod(include, node, template.source);
    const output = await traceableInclude(executionContext, templatesToInclude, await execute(variables, executionContext), !only, ignoreMissing, sandboxed);
    outputBuffer.echo(output);
};
const executeBaseIncludeNodeSynchronously = (node, executionContext, getTemplate) => {
    const { nodeExecutor: execute, outputBuffer, sandboxed, template } = executionContext;
    const { variables: variablesNode } = node.children;
    const { only, ignoreMissing } = node.attributes;
    const templatesToInclude = getTemplate(executionContext);
    const traceableInclude = getSynchronousTraceableMethod(includeSynchronously, node, template.source);
    let variables = execute(variablesNode, executionContext);
    if (isPlainObject(variables)) {
        variables = new Map(Object.entries(variables));
    }
    const output = traceableInclude(executionContext, templatesToInclude, variables, !only, ignoreMissing, sandboxed);
    outputBuffer.echo(output);
};

const executeEmbedNode = (node, executionContext) => {
    return executeBaseIncludeNode(node, executionContext, ({ template }) => {
        const { index } = node.attributes;
        const loadEmbeddedTemplate = getTraceableMethod(() => {
            const { embeddedTemplates } = template;
            // by design, it is guaranteed that an embed node is always executed with an index that corresponds to an existing embedded template
            const embeddedTemplate = embeddedTemplates.get(index);
            return Promise.resolve(embeddedTemplate);
        }, node, template.source);
        return loadEmbeddedTemplate();
    });
};
const executeEmbedNodeSynchronously = (node, executionContext) => {
    return executeBaseIncludeNodeSynchronously(node, executionContext, ({ template }) => {
        const { index } = node.attributes;
        const loadEmbeddedTemplate = getSynchronousTraceableMethod(() => {
            const { embeddedTemplates } = template;
            // by design, it is guaranteed that an embed node is always executed with an index that corresponds to an existing embedded template
            const embeddedTemplate = embeddedTemplates.get(index);
            return embeddedTemplate;
        }, node, template.source);
        return loadEmbeddedTemplate();
    });
};

const executeIncludeNode = (node, executionContext) => {
    const { nodeExecutor: execute } = executionContext;
    return executeBaseIncludeNode(node, executionContext, (executionContext) => {
        return execute(node.children.expression, executionContext);
    });
};
const executeIncludeNodeSynchronously = (node, executionContext) => {
    const { nodeExecutor: execute } = executionContext;
    return executeBaseIncludeNodeSynchronously(node, executionContext, (executionContext) => {
        return execute(node.children.expression, executionContext);
    });
};

const executeWithNode = async (node, executionContext) => {
    const { template, nodeExecutor: execute, context } = executionContext;
    const { variables: variablesNode, body } = node.children;
    const { only } = node.attributes;
    let scopedContext;
    if (variablesNode) {
        const variables = await execute(variablesNode, executionContext);
        if (typeof variables !== "object") {
            throw createRuntimeError(`Variables passed to the "with" tag must be a hash.`, node, template.source);
        }
        if (only) {
            scopedContext = createContext();
        }
        else {
            scopedContext = context.clone();
        }
        scopedContext = createContext(mergeIterables(scopedContext, iteratorToMap(variables)));
    }
    else {
        scopedContext = context.clone();
    }
    scopedContext.set('_parent', context.clone());
    await execute(body, Object.assign(Object.assign({}, executionContext), { context: scopedContext }));
};
const executeWithNodeSynchronously = (node, executionContext) => {
    const { template, nodeExecutor: execute, context } = executionContext;
    const { variables: variablesNode, body } = node.children;
    const { only } = node.attributes;
    let scopedContext;
    if (variablesNode) {
        let variables = execute(variablesNode, executionContext);
        if (isPlainObject(variables)) {
            variables = new Map(Object.entries(variables));
        }
        if (typeof variables !== "object") {
            throw createRuntimeError(`Variables passed to the "with" tag must be a hash.`, node, template.source);
        }
        if (only) {
            scopedContext = new Map();
        }
        else {
            scopedContext = new Map(context.entries());
        }
        scopedContext = new Map([
            ...scopedContext.entries(),
            ...variables.entries()
        ]);
    }
    else {
        scopedContext = new Map(context.entries());
    }
    scopedContext.set('_parent', context);
    execute(body, Object.assign(Object.assign({}, executionContext), { context: scopedContext }));
};

const executeSpacelessNode = (node, executionContext) => {
    const { outputBuffer } = executionContext;
    const { nodeExecutor: execute } = executionContext;
    outputBuffer.start();
    return execute(node.children.body, executionContext)
        .then(() => {
        const content = outputBuffer.getAndClean().replace(/>\s+</g, '><').trim();
        outputBuffer.echo(content);
    });
};
const executeSpacelessNodeSynchronously = (node, executionContext) => {
    const { outputBuffer } = executionContext;
    const { nodeExecutor: execute } = executionContext;
    outputBuffer.start();
    execute(node.children.body, executionContext);
    const content = outputBuffer.getAndClean().replace(/>\s+</g, '><').trim();
    outputBuffer.echo(content);
};

const executeApplyNode = (node, executionContext) => {
    const { outputBuffer, nodeExecutor: execute } = executionContext;
    const { body, filters } = node.children;
    const { line, column } = node;
    outputBuffer.start();
    return execute(body, executionContext)
        .then(async () => {
        let content = outputBuffer.getAndClean();
        const keyValuePairs = getKeyValuePairs(filters);
        while (keyValuePairs.length > 0) {
            const { key, value: filterArguments } = keyValuePairs.pop();
            const filterName = key.attributes.value;
            const filterNode = createFilterNode(createConstantNode(content, line, column), filterName, filterArguments, line, column);
            content = await execute(filterNode, executionContext);
        }
        outputBuffer.echo(content);
    });
};
const executeApplyNodeSynchronously = (node, executionContext) => {
    const { outputBuffer, nodeExecutor: execute } = executionContext;
    const { body, filters } = node.children;
    const { line, column } = node;
    outputBuffer.start();
    execute(body, executionContext);
    let content = outputBuffer.getAndClean();
    const keyValuePairs = getKeyValuePairs(filters);
    while (keyValuePairs.length > 0) {
        const { key, value: filterArguments } = keyValuePairs.pop();
        const filterName = key.attributes.value;
        const filterNode = createFilterNode(createConstantNode(content, line, column), filterName, filterArguments, line, column);
        content = execute(filterNode, executionContext);
    }
    outputBuffer.echo(content);
};

const escapeValue = (template, environment, value, strategy, charset) => {
    if (typeof value === "boolean") {
        return Promise.resolve(value);
    }
    if (isAMarkup(value)) {
        return Promise.resolve(value);
    }
    let result;
    if ((value === null) || (value === undefined)) {
        result = '';
    }
    else {
        const strategyHandler = environment.escapingStrategyHandlers[strategy];
        if (strategyHandler === undefined) {
            return Promise.reject(new Error(`Invalid escaping strategy "${strategy}" (valid ones: ${Object.keys(environment.escapingStrategyHandlers).sort().join(', ')}).`));
        }
        result = strategyHandler(value.toString(), charset || environment.charset, template.name);
    }
    return Promise.resolve(result);
};
const escapeValueSynchronously = (template, environment, value, strategy, charset) => {
    if (typeof value === "boolean") {
        return value;
    }
    if (isAMarkup(value)) {
        return value;
    }
    let result;
    if ((value === null) || (value === undefined)) {
        result = '';
    }
    else {
        const strategyHandler = environment.escapingStrategyHandlers[strategy];
        if (strategyHandler === undefined) {
            throw new Error(`Invalid escaping strategy "${strategy}" (valid ones: ${Object.keys(environment.escapingStrategyHandlers).sort().join(', ')}).`);
        }
        result = strategyHandler(value.toString(), charset || environment.charset, template.name);
    }
    return result;
};

const executeEscapeNode = (node, executionContext) => {
    const { template, environment, nodeExecutor: execute } = executionContext;
    const { strategy } = node.attributes;
    const { body } = node.children;
    return execute(body, executionContext)
        .then((value) => {
        const traceableEscape = getTraceableMethod(escapeValue, node, template.source);
        return traceableEscape(template, environment, value, strategy, null);
    });
};
const executeEscapeNodeSynchronously = (node, executionContext) => {
    const { template, environment, nodeExecutor: execute } = executionContext;
    const { strategy } = node.attributes;
    const { body } = node.children;
    const value = execute(body, executionContext);
    const traceableEscape = getSynchronousTraceableMethod(escapeValueSynchronously, node, template.source);
    return traceableEscape(template, environment, value, strategy, null);
};

const executeArrowFunctionNode = (node, executionContext) => {
    const { context, nodeExecutor: execute } = executionContext;
    const { body, names } = node.children;
    const assignmentNodes = Object.values(names.children);
    return Promise.resolve((...functionArgs) => {
        let index = 0;
        for (const assignmentNode of assignmentNodes) {
            const { name } = assignmentNode.attributes;
            context.set(name, functionArgs[index]);
            index++;
        }
        return execute(body, executionContext);
    });
};
const executeArrowFunctionNodeSynchronously = (node, executionContext) => {
    const { context, nodeExecutor: execute } = executionContext;
    const { body, names } = node.children;
    const assignmentNodes = Object.values(names.children);
    return (...functionArgs) => {
        let index = 0;
        for (const assignmentNode of assignmentNodes) {
            const { name } = assignmentNode.attributes;
            context.set(name, functionArgs[index]);
            index++;
        }
        return execute(body, executionContext);
    };
};

const executeSandboxNode = (node, executionContext) => {
    const { body } = node.children;
    const { nodeExecutor: execute } = executionContext;
    return execute(body, Object.assign(Object.assign({}, executionContext), { sandboxed: true }));
};
const executeSandboxNodeSynchronously = (node, executionContext) => {
    const { body } = node.children;
    const { nodeExecutor: execute } = executionContext;
    return execute(body, Object.assign(Object.assign({}, executionContext), { sandboxed: true }));
};

const executeDoNode = (node, executionContext) => {
    return executionContext.nodeExecutor(node.children.body, executionContext);
};
const executeDoNodeSynchronously = (node, executionContext) => {
    return executionContext.nodeExecutor(node.children.body, executionContext);
};

const executeDeprecatedNode = (node, executionContext) => {
    const { template, nodeExecutor: execute } = executionContext;
    const { message } = node.children;
    return execute(message, executionContext)
        .then((message) => {
        console.warn(`${message} ("${template.name}" at line ${node.line}, column ${node.column})`);
    });
};
const executeDeprecatedNodeSynchronously = (node, executionContext) => {
    const { template, nodeExecutor: execute } = executionContext;
    const { message: messageNode } = node.children;
    const message = execute(messageNode, executionContext);
    console.warn(`${message} ("${template.name}" at line ${node.line}, column ${node.column})`);
};

const executeSpreadNode = (node, executionContext) => {
    const { iterable } = node.children;
    const { nodeExecutor: execute } = executionContext;
    return execute(iterable, executionContext);
};
const executeSpreadNodeSynchronously = (node, executionContext) => {
    const { iterable: iterableNode } = node.children;
    const { nodeExecutor: execute } = executionContext;
    const iterable = execute(iterableNode, executionContext);
    return iteratorToHash(iterable);
};

const executeCheckSecurityNode = (node, executionContext) => {
    const { template, environment, sandboxed } = executionContext;
    const { usedTags, usedFunctions, usedFilters } = node.attributes;
    if (sandboxed) {
        const issue = environment.sandboxPolicy.checkSecurity([...usedTags.keys()], [...usedFilters.keys()], [...usedFunctions.keys()]);
        if (issue !== null) {
            const { type, token } = issue;
            let node;
            if (type === "tag") {
                node = usedTags.get(token);
            }
            else if (type === "filter") {
                node = usedFilters.get(token);
            }
            else {
                node = usedFunctions.get(token);
            }
            throw createRuntimeError(issue.message, node, template.source);
        }
    }
    return Promise.resolve();
};
const executeCheckSecurityNodeSynchronously = (node, executionContext) => {
    const { template, environment, sandboxed } = executionContext;
    const { usedTags, usedFunctions, usedFilters } = node.attributes;
    if (sandboxed) {
        const issue = environment.sandboxPolicy.checkSecurity([...usedTags.keys()], [...usedFilters.keys()], [...usedFunctions.keys()]);
        if (issue !== null) {
            const { type, token } = issue;
            let node;
            if (type === "tag") {
                node = usedTags.get(token);
            }
            else if (type === "filter") {
                node = usedFilters.get(token);
            }
            else {
                node = usedFunctions.get(token);
            }
            throw createRuntimeError(issue.message, node, template.source);
        }
    }
};

const executeFlushNode = (_node, { outputBuffer }) => {
    outputBuffer.flush();
    return Promise.resolve();
};
const executeFlushNodeSynchronously = (_node, { outputBuffer }) => {
    outputBuffer.flush();
};

const executeConstantNode = (node) => {
    return Promise.resolve(node.attributes.value);
};
const executeConstantNodeSynchronously = (node) => {
    return node.attributes.value;
};

const executeLineNode = () => {
    return Promise.resolve();
};
const executeLineNodeSynchronously = () => {
};

const executeCommentNode = () => {
    return Promise.resolve();
};
const executeCommentNodeSynchronously = () => {
    return;
};

const executeBaseNode = async (node, executionContext) => {
    const output = [];
    const { nodeExecutor: execute } = executionContext;
    for (const [, child] of Object.entries(node.children)) {
        output.push(await execute(child, executionContext));
    }
    return output;
};
const executeBaseNodeSynchronously = (node, executionContext) => {
    const output = [];
    const { nodeExecutor: execute } = executionContext;
    for (const [, child] of Object.entries(node.children)) {
        output.push(execute(child, executionContext));
    }
    return output;
};

const binaryNodeTypes = ["add", "and", "bitwise_and", "bitwise_or", "bitwise_xor", "concatenate", "divide", "divide_and_floor", "ends_with", "has_every", "has_some", "is_equal_to", "is_greater_than", "is_greater_than_or_equal_to", "is_in", "is_less_than", "is_less_than_or_equal_to", "is_not_equal_to", "is_not_in", "matches", "modulo", "multiply", "or", "power", "range", "spaceship", "starts_with", "subtract"];
const isABinaryNode = (node) => {
    return binaryNodeTypes.includes(node.type);
};
const unaryNodeTypes = ["negative", "not", "positive"];
const isAUnaryNode = (node) => {
    return unaryNodeTypes.includes(node.type);
};
const callNodeTypes = ["filter", "function", "test"];
const isACallNode = (node) => {
    return callNodeTypes.includes(node.type);
};
/**
 * Execute the passed node against the passed execution context.
 *
 * @param node The node to execute
 * @param executionContext The context the node is executed against
 */
const executeNode = (node, executionContext) => {
    let executor;
    if (isABinaryNode(node)) {
        executor = executeBinaryNode;
    }
    else if (isACallNode(node)) {
        executor = executeCallNode;
    }
    else if (isAUnaryNode(node)) {
        executor = executeUnaryNode;
    }
    else if (node.type === null) {
        executor = executeBaseNode;
    }
    else if (node.type === "apply") {
        executor = executeApplyNode;
    }
    else if (node.type === "array") {
        executor = executeArrayNode;
    }
    else if (node.type === "arrow_function") {
        executor = executeArrowFunctionNode;
    }
    else if (node.type === "assignment") {
        executor = executeAssignmentNode;
    }
    else if (node.type === "attribute_accessor") {
        executor = executeAttributeAccessorNode;
    }
    else if (node.type === "block_function") {
        executor = executeBlockFunction;
    }
    else if (node.type === "block_reference") {
        executor = executeBlockReferenceNode;
    }
    else if (node.type === "check_security") {
        executor = executeCheckSecurityNode;
    }
    else if (node.type === "check_to_string") {
        executor = executeCheckToStringNode;
    }
    else if (node.type === "comment") {
        executor = executeCommentNode;
    }
    else if (node.type === "conditional") {
        executor = executeConditionalNode;
    }
    else if (node.type === "constant") {
        executor = executeConstantNode;
    }
    else if (node.type === "deprecated") {
        executor = executeDeprecatedNode;
    }
    else if (node.type === "do") {
        executor = executeDoNode;
    }
    else if (node.type === "embed") {
        executor = executeEmbedNode;
    }
    else if (node.type === "escape") {
        executor = executeEscapeNode;
    }
    else if (node.type === "flush") {
        executor = executeFlushNode;
    }
    else if (node.type === "for") {
        executor = executeForNode;
    }
    else if (node.type === "for_loop") {
        executor = executeForLoopNode;
    }
    else if (node.type === "hash") {
        executor = executeHashNode;
    }
    else if (node.type === "if") {
        executor = executeIfNode;
    }
    else if (node.type === "import") {
        executor = executeImportNode;
    }
    else if (node.type === "include") {
        executor = executeIncludeNode;
    }
    else if (node.type === "line") {
        executor = executeLineNode;
    }
    else if (node.type === "method_call") {
        executor = executeMethodCall;
    }
    else if (node.type === "name") {
        executor = executeNameNode;
    }
    else if (node.type === "nullish_coalescing") {
        executor = executeConditionalNode;
    }
    else if (node.type === "parent_function") {
        executor = executeParentFunction;
    }
    else if (node.type === "print") {
        executor = executePrintNode;
    }
    else if (node.type === "sandbox") {
        executor = executeSandboxNode;
    }
    else if (node.type === "set") {
        executor = executeSetNode;
    }
    else if (node.type === "spaceless") {
        executor = executeSpacelessNode;
    }
    else if (node.type === "spread") {
        executor = executeSpreadNode;
    }
    else if (node.type === "template") {
        executor = executeTemplateNode;
    }
    else if (node.type === "text") {
        executor = executeTextNode;
    }
    else if (node.type === "verbatim") {
        executor = executeTextNode;
    }
    else if (node.type === "with") {
        executor = executeWithNode;
    }
    else {
        return Promise.reject(createRuntimeError(`Unrecognized node of type "${node.type}"`, node, executionContext.template.source));
    }
    return executor(node, executionContext);
};
const executeNodeSynchronously = (node, executionContext) => {
    let executor;
    if (isABinaryNode(node)) {
        executor = executeBinaryNodeSynchronously;
    }
    else if (isACallNode(node)) {
        executor = executeCallNodeSynchronously;
    }
    else if (isAUnaryNode(node)) {
        executor = executeUnaryNodeSynchronously;
    }
    else if (node.type === null) {
        executor = executeBaseNodeSynchronously;
    }
    else if (node.type === "apply") {
        executor = executeApplyNodeSynchronously;
    }
    else if (node.type === "array") {
        executor = executeArrayNodeSynchronously;
    }
    else if (node.type === "arrow_function") {
        executor = executeArrowFunctionNodeSynchronously;
    }
    else if (node.type === "assignment") {
        executor = executeAssignmentNodeSynchronously;
    }
    else if (node.type === "attribute_accessor") {
        executor = executeAttributeAccessorNodeSynchronously;
    }
    else if (node.type === "block_function") {
        executor = executeSynchronousBlockFunction;
    }
    else if (node.type === "block_reference") {
        executor = executeBlockReferenceNodeSynchronously;
    }
    else if (node.type === "check_security") {
        executor = executeCheckSecurityNodeSynchronously;
    }
    else if (node.type === "check_to_string") {
        executor = executeCheckToStringNodeSynchronously;
    }
    else if (node.type === "comment") {
        executor = executeCommentNodeSynchronously;
    }
    else if (node.type === "conditional") {
        executor = executeConditionalNodeSynchronously;
    }
    else if (node.type === "constant") {
        executor = executeConstantNodeSynchronously;
    }
    else if (node.type === "deprecated") {
        executor = executeDeprecatedNodeSynchronously;
    }
    else if (node.type === "do") {
        executor = executeDoNodeSynchronously;
    }
    else if (node.type === "embed") {
        executor = executeEmbedNodeSynchronously;
    }
    else if (node.type === "escape") {
        executor = executeEscapeNodeSynchronously;
    }
    else if (node.type === "flush") {
        executor = executeFlushNodeSynchronously;
    }
    else if (node.type === "for") {
        executor = executeForNodeSynchronously;
    }
    else if (node.type === "for_loop") {
        executor = executeForLoopNodeSynchronously;
    }
    else if (node.type === "hash") {
        executor = executeHashNodeSynchronously;
    }
    else if (node.type === "if") {
        executor = executeIfNodeSynchronously;
    }
    else if (node.type === "import") {
        executor = executeImportNodeSynchronously;
    }
    else if (node.type === "include") {
        executor = executeIncludeNodeSynchronously;
    }
    else if (node.type === "line") {
        executor = executeLineNodeSynchronously;
    }
    else if (node.type === "method_call") {
        executor = executeMethodCallSynchronously;
    }
    else if (node.type === "name") {
        executor = executeNameNodeSynchronously;
    }
    else if (node.type === "nullish_coalescing") {
        executor = executeConditionalNodeSynchronously;
    }
    else if (node.type === "parent_function") {
        executor = executeParentFunctionSynchronously;
    }
    else if (node.type === "print") {
        executor = executePrintNodeSynchronously;
    }
    else if (node.type === "sandbox") {
        executor = executeSandboxNodeSynchronously;
    }
    else if (node.type === "set") {
        executor = executeSetNodeSynchronously;
    }
    else if (node.type === "spaceless") {
        executor = executeSpacelessNodeSynchronously;
    }
    else if (node.type === "spread") {
        executor = executeSpreadNodeSynchronously;
    }
    else if (node.type === "template") {
        executor = executeTemplateNodeSynchronously;
    }
    else if (node.type === "text") {
        executor = executeTextNodeSynchronously;
    }
    else if (node.type === "verbatim") {
        executor = executeTextNodeSynchronously;
    }
    else if (node.type === "with") {
        executor = executeWithNodeSynchronously;
    }
    else {
        throw createRuntimeError(`Unrecognized node of type "${node.type}"`, node, executionContext.template.source);
    }
    return executor(node, executionContext);
};

const createApplyTagHandler = () => {
    const tag = 'apply';
    const tokenHandler = {
        tag,
        initialize: (parser) => {
            return (token, stream) => {
                const { line, column } = token;
                const filterDefinitions = parser.parseFilterDefinitions(stream);
                stream.expect("TAG_END");
                let body = parser.subparse(stream, tag, (token) => {
                    return token.test("NAME", 'endapply');
                });
                stream.next();
                stream.expect("TAG_END");
                return createApplyNode(createArrayNode(filterDefinitions.map(({ name, arguments: filterArgument }) => {
                    return {
                        key: createConstantNode(name, line, column),
                        value: filterArgument
                    };
                }), line, column), body, line, column);
            };
        }
    };
    return tokenHandler;
};

/**
 * Marks a section of a template to be escaped or not.
 */
const createAutoEscapeTagHandler = () => {
    const tag = 'autoescape';
    return {
        tag,
        initialize: (parser) => {
            return (token, stream) => {
                const { line, column } = token;
                let strategy;
                if (stream.test("TAG_END")) {
                    strategy = "html";
                }
                else {
                    const expression = parser.parseExpression(stream);
                    if (expression.type !== "constant" ||
                        (typeof expression.attributes.value !== "string" && expression.attributes.value !== false)) {
                        const { line, column } = expression;
                        throw createParsingError('An escaping strategy must be a string or false.', { line, column }, stream.source);
                    }
                    const { value } = expression.attributes;
                    strategy = value;
                }
                stream.expect("TAG_END");
                let body = parser.subparse(stream, tag, (token) => {
                    return token.test("NAME", 'endautoescape');
                });
                stream.next();
                stream.expect("TAG_END");
                return createAutoEscapeNode(strategy, body, line, column, tag);
            };
        }
    };
};

/**
 * Marks a section of a template as being reusable.
 *
 * <pre>
 *  {% block head %}
 *    <link rel="stylesheet" href="style.css" />
 *    <title>{% block title %}{% endblock %} - My Webpage</title>
 *  {% endblock %}
 * </pre>
 */
const createBlockTagHandler = () => {
    const tag = 'block';
    return {
        tag,
        initialize: (parser) => {
            return (token, stream) => {
                const { line, column } = token;
                const name = stream.expect("NAME").value;
                let block = parser.getBlock(name);
                if (block !== null) {
                    throw createParsingError(`The block '${name}' has already been defined at {${block.line}:${block.column}}.`, { line, column }, stream.source);
                }
                block = createBlockNode(name, createNode(), line, column);
                parser.setBlock(name, block);
                parser.pushLocalScope();
                parser.pushBlockStack(name);
                let body;
                if (stream.nextIf("TAG_END")) {
                    body = parser.subparse(stream, tag, (token) => {
                        return token.test("NAME", 'endblock');
                    });
                    stream.next();
                    const token = stream.nextIf("NAME");
                    if (token) {
                        const value = token.value;
                        if (value !== name) {
                            const { line, column } = token;
                            throw createParsingError(`Expected endblock for block "${name}" (but "${value}" given).`, { line, column }, stream.source);
                        }
                    }
                }
                else {
                    body = createNode({
                        0: createPrintNode(parser.parseExpression(stream), line, column)
                    });
                }
                stream.expect("TAG_END");
                block.children.body = body;
                parser.popBlockStack();
                parser.popLocalScope();
                return createBlockReferenceNode(name, line, column, tag);
            };
        }
    };
};

/**
 * Deprecates a section of a template.
 *
 * <pre>
 * {% deprecated 'The "base.twig" template is deprecated, use "layout.twig" instead.' %}
 *
 * {% extends 'layout.html.twig' %}
 * </pre>
 *
 * @author Eric MORAND <eric.morand@gmail.com>
 */
const createDeprecatedTagHandler = () => {
    const tag = 'deprecated';
    return {
        tag,
        initialize: (parser) => {
            return (token, stream) => {
                const expression = parser.parseExpression(stream);
                stream.expect("TAG_END");
                return createDeprecatedNode(expression, token.line, token.column, tag);
            };
        }
    };
};

const createDoTagHandler = () => {
    const tag = 'do';
    return {
        tag,
        initialize: (parser) => {
            return (token, stream) => {
                const expression = parser.parseExpression(stream);
                stream.expect("TAG_END");
                return createDoNode(expression, token.line, token.column, tag);
            };
        }
    };
};

const createIncludeTagHandler = () => {
    const tag = 'include';
    return {
        tag,
        initialize: (parser) => {
            return (token, stream) => {
                const { line, column } = token;
                const expression = parser.parseExpression(stream);
                const { ignoreMissing, only, variables } = parseArguments(parser, stream, line, column);
                return createIncludeNode({
                    only,
                    ignoreMissing
                }, {
                    expression,
                    variables
                }, token.line, token.column, tag);
            };
        }
    };
};
const parseArguments = (parser, stream, line, column) => {
    let ignoreMissing = false;
    if (stream.nextIf("NAME", 'ignore')) {
        stream.expect("NAME", 'missing');
        ignoreMissing = true;
    }
    let variables = createArrayNode([], line, column);
    if (stream.nextIf("NAME", 'with')) {
        variables = parser.parseExpression(stream);
    }
    let only = false;
    if (stream.nextIf("NAME", 'only')) {
        only = true;
    }
    stream.expect("TAG_END");
    return {
        variables,
        only,
        ignoreMissing
    };
};

const createEmbedTagHandler = () => {
    const tag = 'embed';
    return {
        tag,
        initialize: (parser) => {
            return (token, stream) => {
                const { line, column } = token;
                let parent = parser.parseExpression(stream);
                let embedArguments = parseArguments(parser, stream, line, column);
                let variables = embedArguments.variables;
                let only = embedArguments.only;
                let ignoreMissing = embedArguments.ignoreMissing;
                let parentToken;
                let fakeParentToken;
                parentToken = fakeParentToken = new twigLexer.Token("STRING", '__parent__', token.line, token.column);
                if (parent.type === "constant") {
                    parentToken = new twigLexer.Token("STRING", parent.attributes.value, token.line, token.column);
                }
                else if (parent.type === "name") {
                    parentToken = new twigLexer.Token("NAME", parent.attributes.name, token.line, token.column);
                }
                // inject a fake parent to make the parent() function work
                stream.injectTokens([
                    new twigLexer.Token("TAG_START", '', token.line, token.column),
                    new twigLexer.Token("NAME", 'extends', token.line, token.column),
                    parentToken,
                    new twigLexer.Token("TAG_END", '', token.line, token.column),
                ]);
                let module = parser.parse(stream, tag, (token) => {
                    return token.test("NAME", 'endembed');
                });
                stream.next();
                // override the parent with the correct one
                if (fakeParentToken === parentToken) {
                    module.children.parent = parent;
                }
                parser.embedTemplate(module);
                stream.expect("TAG_END");
                const { index } = module.attributes;
                return createEmbedNode({
                    index,
                    only,
                    ignoreMissing
                }, {
                    variables
                }, token.line, token.column, tag);
            };
        }
    };
};

/**
 * Loops over each item of a sequence.
 *
 * <pre>
 * <ul>
 *  {% for user in users %}
 *    <li>{{ user.username|e }}</li>
 *  {% endfor %}
 * </ul>
 * </pre>
 */
const createExtendsTagHandler = () => {
    const tag = 'extends';
    return {
        tag,
        initialize: (parser) => {
            return (token, stream) => {
                const { line, column } = token;
                if (parser.peekBlockStack()) {
                    throw createParsingError('Cannot use "extend" in a block.', { line, column }, stream.source);
                }
                else if (!parser.isMainScope()) {
                    throw createParsingError('Cannot use "extend" in a macro.', { line, column }, stream.source);
                }
                if (parser.parent !== null) {
                    throw createParsingError('Multiple extends tags are forbidden.', { line, column }, stream.source);
                }
                parser.parent = parser.parseExpression(stream);
                stream.expect("TAG_END");
                return null;
            };
        }
    };
};

/**
 * Filters a section of a template by applying filters.
 *
 * <pre>
 * {% filter upper %}
 *  This text becomes uppercase
 * {% endfilter %}
 * </pre>
 */
const createFilterTagHandler = () => {
    const tag = 'filter';
    return {
        tag,
        initialize: (parser) => {
            return (token, stream) => {
                let line = token.line;
                let column = token.column;
                console.warn(`The "filter" tag in "${stream.source.name}" at line ${line} is deprecated since Twig 2.9, use the "apply" tag instead.`);
                const name = parser.getVarName();
                const blockFunctionNode = createBlockFunctionNode(createConstantNode(name, line, column), null, line, column, tag);
                const filterNode = parser.parseFilterExpressionRaw(stream, blockFunctionNode, tag);
                stream.expect("TAG_END");
                const body = parser.subparse(stream, tag, (token) => {
                    return token.test("NAME", 'endfilter');
                });
                stream.next();
                stream.expect("TAG_END");
                const block = createBlockNode(name, body, line, column);
                parser.setBlock(name, block);
                return createPrintNode(filterNode, line, column);
            };
        }
    };
};

const createFlushTagHandler = () => {
    const tag = 'flush';
    return {
        tag,
        initialize: () => {
            return (token, stream) => {
                stream.expect("TAG_END");
                return createFlushNode(token.line, token.column, tag);
            };
        }
    };
};

/**
 * Loops over each item of a sequence.
 *
 * <pre>
 * <ul>
 *  {% for user in users %}
 *    <li>{{ user.username|e }}</li>
 *  {% endfor %}
 * </ul>
 * </pre>
 */
const createForTagHandler = () => {
    const tag = 'for';
    const decideForFork = (token) => {
        return token.test("NAME", ['else', 'endfor']);
    };
    const decideForEnd = (token) => {
        return token.test("NAME", 'endfor');
    };
    // the loop variable cannot be used in the condition
    const checkLoopUsageCondition = (stream, node) => {
        if ((node.type === "attribute_accessor") && (node.children.target.type === "name") && (node.children.target.attributes.name === 'loop')) {
            throw createParsingError('The "loop" variable cannot be used in a looping condition.', node, stream.source);
        }
        for (const [, child] of getChildren(node)) {
            checkLoopUsageCondition(stream, child);
        }
    };
    // check usage of non-defined loop-items
    // it does not catch all problems (for instance when a for is included into another or when the variable is used in an include)
    const checkLoopUsageBody = (stream, node) => {
        if ((node.type === "attribute_accessor") && (node.children.target.type === "name") && (node.children.target.attributes.name === "loop")) {
            const { attribute } = node.children;
            if (attribute.type === "constant" && (['length', 'revindex0', 'revindex', 'last'].indexOf(attribute.attributes.value) > -1)) {
                throw createParsingError(`The "loop.${attribute.attributes.value}" variable is not defined when looping with a condition.`, node, stream.source);
            }
        }
        // should check for parent.loop.XXX usage
        if (node.type === "for") {
            return;
        }
        for (let [, child] of getChildren(node)) {
            checkLoopUsageBody(stream, child);
        }
    };
    return {
        tag,
        initialize: (parser, level) => {
            return (token, stream) => {
                const { line, column } = token;
                const targets = parser.parseAssignmentExpression(stream);
                stream.expect("OPERATOR", 'in');
                let sequence = parser.parseExpression(stream);
                let ifExpression = null;
                if ((level < 3) && stream.nextIf("NAME", 'if')) {
                    console.warn(`Using an "if" condition on "for" tag in "${stream.source.name}" at line ${line} is deprecated since Twig 2.10.0, use a "filter" filter or an "if" condition inside the "for" body instead (if your condition depends on a variable updated inside the loop).`);
                    ifExpression = parser.parseExpression(stream);
                }
                stream.expect("TAG_END");
                let body = parser.subparse(stream, tag, decideForFork);
                let elseToken;
                if (stream.next().value == 'else') {
                    stream.expect("TAG_END");
                    elseToken = parser.subparse(stream, tag, decideForEnd);
                    stream.next();
                }
                else {
                    elseToken = null;
                }
                stream.expect("TAG_END");
                let keyTarget;
                let valueTarget;
                if (getChildrenCount(targets) > 1) {
                    keyTarget = targets.children[0];
                    keyTarget = createAssignmentNode(keyTarget.attributes.name, keyTarget.line, keyTarget.column);
                    valueTarget = targets.children[1];
                    valueTarget = createAssignmentNode(valueTarget.attributes.name, valueTarget.line, valueTarget.column);
                }
                else {
                    keyTarget = createAssignmentNode('_key', line, column);
                    valueTarget = targets.children[0];
                    valueTarget = createAssignmentNode(valueTarget.attributes.name, valueTarget.line, valueTarget.column);
                }
                if (ifExpression) {
                    checkLoopUsageCondition(stream, ifExpression);
                    checkLoopUsageBody(stream, body);
                }
                return createForNode(keyTarget, valueTarget, sequence, ifExpression, body, elseToken, line, column, tag);
            };
        }
    };
};

/**
 * Imports macros.
 *
 * <pre>
 *   {% from 'forms.html' import forms %}
 * </pre>
 */
const createFromTagHandler = () => {
    const tag = 'from';
    return {
        tag,
        initialize: (parser) => {
            return (token, stream) => {
                const templateName = parser.parseExpression(stream);
                stream.expect("NAME", 'import');
                const targets = new Map();
                do {
                    let name = stream.expect("NAME").value;
                    let alias = name;
                    if (stream.nextIf("NAME", 'as')) {
                        alias = stream.expect("NAME").value;
                    }
                    targets.set(name, alias);
                    if (!stream.nextIf("PUNCTUATION", ',')) {
                        break;
                    }
                } while (true);
                stream.expect("TAG_END");
                const aliasNode = createAssignmentNode(parser.getVarName(), token.line, token.column);
                const importNode = createImportNode(templateName, aliasNode, true, token.line, token.column, tag);
                for (const [name, alias] of targets) {
                    parser.addImportedSymbol("method", alias, name, aliasNode);
                }
                return importNode;
            };
        }
    };
};

/**
 * Tests a condition.
 *
 * <pre>
 * {% if users %}
 *  <ul>
 *    {% for user in users %}
 *      <li>{{ user.username|e }}</li>
 *    {% endfor %}
 *  </ul>
 * {% endif %}
 * </pre>
 */
const createIfTagHandler = () => {
    const tag = 'if';
    const decideIfFork = (token) => {
        return token.test("NAME", ['elseif', 'else', 'endif']);
    };
    return {
        tag,
        initialize: (parser) => {
            return (token, stream) => {
                const { line, column } = token;
                let expression = parser.parseExpression(stream);
                stream.expect("TAG_END");
                let index = 0;
                let body = parser.subparse(stream, tag, decideIfFork);
                const tests = {
                    [index++]: expression,
                    [index++]: body
                };
                let elseNode = null;
                let end = stream.isEOF();
                while (!end) {
                    switch (stream.next().value) {
                        case 'else':
                            stream.expect("TAG_END");
                            elseNode = parser.subparse(stream, tag, (token) => {
                                return token.test("NAME", 'endif');
                            });
                            break;
                        case 'elseif':
                            expression = parser.parseExpression(stream);
                            stream.expect("TAG_END");
                            body = parser.subparse(stream, tag, decideIfFork);
                            tests[index++] = expression;
                            tests[index++] = body;
                            break;
                        case 'endif':
                            end = true;
                            break;
                    }
                }
                stream.expect("TAG_END");
                return createIfNode(createNode(tests), elseNode, line, column, tag);
            };
        }
    };
};

const createImportTagHandler = () => {
    const tag = 'import';
    return {
        tag,
        initialize: (parser) => {
            return (token, stream) => {
                const templateName = parser.parseExpression(stream);
                stream.expect("NAME", 'as');
                const alias = createAssignmentNode(stream.expect("NAME").value, token.line, token.column);
                stream.expect("TAG_END");
                parser.addImportedSymbol('template', alias.attributes.name);
                return createImportNode(templateName, alias, parser.isMainScope(), token.line, token.column, tag);
            };
        }
    };
};

const createLineTagHandler = () => {
    const tag = 'line';
    return {
        tag,
        initialize: () => {
            return (token, stream) => {
                const numberToken = stream.expect("NUMBER");
                stream.expect("TAG_END");
                return createLineNode(Number(numberToken.value), token.line, token.column, tag);
            };
        }
    };
};

/**
 * Defines a macro.
 *
 * <pre>
 * {% macro input(name, value, type, size) %}
 *    <input type="{{ type|default('text') }}" name="{{ name }}" value="{{ value|e }}" size="{{ size|default(20) }}" />
 * {% endmacro %}
 * </pre>
 */
const createMacroTagHandler = () => {
    const tag = 'macro';
    return {
        tag,
        initialize: (parser) => {
            return (token, stream) => {
                const { line, column } = token;
                const name = stream.expect("NAME").value;
                const macroArguments = parser.parseArguments(stream, true, true);
                for (const { key, value: macroArgument } of getKeyValuePairs(macroArguments)) {
                    const { value: argumentName } = key.attributes;
                    if (argumentName === VARARGS_NAME) {
                        throw createParsingError(`The argument "${VARARGS_NAME}" in macro "${name}" cannot be defined because the variable "${VARARGS_NAME}" is reserved for arbitrary arguments.`, macroArgument, stream.source);
                    }
                }
                stream.expect("TAG_END");
                parser.pushLocalScope();
                const body = parser.subparse(stream, tag, (token) => {
                    return token.test("NAME", 'endmacro');
                });
                stream.next();
                const nextToken = stream.nextIf("NAME");
                if (nextToken) {
                    const value = nextToken.value;
                    if (value != name) {
                        const { line, column } = nextToken;
                        throw createParsingError(`Expected endmacro for macro "${name}" (but "${value}" given).`, { line, column }, stream.source);
                    }
                }
                parser.popLocalScope();
                stream.expect("TAG_END");
                parser.setMacro(name, createMacroNode(name, createNode({ body }, line, column), macroArguments, line, column, tag));
                return null;
            };
        }
    };
};

/**
 * Check whether a string consists of whitespace character(s) only.
 *
 * @param {string} value
 * @return boolean
 */
function isMadeOfWhitespaceOnly(value) {
    let regExp = /^[ \r\n\t\f\v]+$/;
    return regExp.test(value);
}

const createSandboxTagHandler = () => {
    const tag = 'sandbox';
    return {
        tag,
        initialize: (parser) => {
            return (token, stream) => {
                stream.expect("TAG_END");
                let body = parser.subparse(stream, tag, (token) => {
                    return token.test("NAME", 'endsandbox');
                });
                stream.next();
                stream.expect("TAG_END");
                // in a sandbox tag, only include tags are allowed
                if (body.type !== "include" && body.type !== "embed") {
                    for (const keyAndChild of getChildren(body)) {
                        const child = keyAndChild[1];
                        if (!(child.type === "text" && isMadeOfWhitespaceOnly(child.attributes.data))) {
                            if (child.type !== "include" && child.type !== "embed") {
                                throw createParsingError('Only "include" tags are allowed within a "sandbox" section.', child, stream.source);
                            }
                        }
                    }
                }
                return createSandboxNode(body, token.line, token.column, tag);
            };
        }
    };
};

const createSetTagHandler = () => {
    const tag = 'set';
    return {
        tag,
        initialize: (parser) => {
            return (token, stream) => {
                const { line, column } = token;
                const names = parser.parseAssignmentExpression(stream);
                let capture = false;
                let values;
                if (stream.nextIf("OPERATOR", '=')) {
                    values = parser.parseMultiTargetExpression(stream);
                    stream.expect("TAG_END");
                    if (getChildrenCount(names) !== getChildrenCount(values)) {
                        const { line, column } = stream.current;
                        throw createParsingError('When using set, you must have the same number of variables and assignments.', { line, column }, stream.source);
                    }
                }
                else {
                    capture = true;
                    if (getChildrenCount(names) > 1) {
                        const { line, column } = stream.current;
                        throw createParsingError('When using set with a block, you cannot have a multi-target.', { line, column }, stream.source);
                    }
                    stream.expect("TAG_END");
                    values = parser.subparse(stream, tag, (token) => {
                        return token.test("NAME", 'endset');
                    });
                    stream.next();
                    stream.expect("TAG_END");
                }
                return createSetNode(capture, names, values, line, column, tag);
            };
        }
    };
};

/**
 * Loops over each item of a sequence.
 *
 * <pre>
 * <ul>
 *  {% for user in users %}
 *    <li>{{ user.username|e }}</li>
 *  {% endfor %}
 * </ul>
 * </pre>
 */
const createSpacelessTagHandler = () => {
    const tag = 'spaceless';
    return {
        tag,
        initialize: (parser) => {
            return (token, stream) => {
                const { line, column } = token;
                console.warn(`The "spaceless" tag in "${stream.source.name}" at line ${line} is deprecated since Twig 2.7, use the "spaceless" filter instead.`);
                stream.expect("TAG_END");
                const body = parser.subparse(stream, tag, (token) => {
                    return token.test("NAME", 'endspaceless');
                });
                stream.next();
                stream.expect("TAG_END");
                return createSpacelessNode(body, line, column, tag);
            };
        }
    };
};

const createUseTagHandler = () => {
    const tag = 'use';
    return {
        tag,
        initialize: (parser) => {
            return (token, stream) => {
                const { line, column } = token;
                const template = parser.parseExpression(stream);
                if (template.type !== "constant") {
                    throw createParsingError('The template references in a "use" statement must be a string.', { line, column }, stream.source);
                }
                const targets = {};
                if (stream.nextIf("NAME", 'with')) {
                    do {
                        const name = stream.expect("NAME").value;
                        let alias = name;
                        if (stream.nextIf("NAME", 'as')) {
                            alias = stream.expect("NAME").value;
                        }
                        targets[name] = createConstantNode(alias, line, column);
                        if (!stream.nextIf("PUNCTUATION", ',')) {
                            break;
                        }
                    } while (true);
                }
                stream.expect("TAG_END");
                parser.addTrait(createTraitNode(template, createNode(targets, line, column), line, column));
                return createNode({}, line, column, tag);
            };
        }
    };
};

const createVerbatimTagHandler = () => {
    const tag = 'verbatim';
    return {
        tag,
        initialize: (parser) => {
            return (token, stream) => {
                stream.expect("TAG_END");
                const text = parser.subparse(stream, tag, (token) => {
                    return token.test("NAME", 'endverbatim');
                });
                stream.next();
                stream.expect("TAG_END");
                let content = '';
                if (text.type === "text") {
                    content = text.attributes.data;
                }
                return createVerbatimNode(content, token.line, token.column, tag);
            };
        }
    };
};

const createWithTagHandler = () => {
    const tag = 'with';
    return {
        tag,
        initialize: (parser) => {
            return (token, stream) => {
                let variables = null;
                let only = false;
                if (!stream.test("TAG_END")) {
                    variables = parser.parseExpression(stream);
                    only = stream.nextIf("NAME", 'only') !== null;
                }
                stream.expect("TAG_END");
                let body = parser.subparse(stream, tag, (token) => {
                    return token.test("NAME", 'endwith');
                });
                stream.next();
                stream.expect("TAG_END");
                return createWithNode(body, variables, only, token.line, token.column, tag);
            };
        }
    };
};

const createExtensionSet = () => {
    const binaryOperators = [];
    const filters = new Map();
    const functions = new Map();
    const nodeVisitors = [];
    const tagHandlers = [];
    const tests = new Map();
    const unaryOperators = [];
    const extensionSet = {
        get binaryOperators() {
            return binaryOperators;
        },
        get filters() {
            return filters;
        },
        get functions() {
            return functions;
        },
        get nodeVisitors() {
            return nodeVisitors;
        },
        get tagHandlers() {
            return tagHandlers;
        },
        get tests() {
            return tests;
        },
        get unaryOperators() {
            return unaryOperators;
        },
        addExtension: (extension) => {
            // filters
            for (const filter of extension.filters) {
                extensionSet.addFilter(filter);
            }
            // functions
            for (const function_ of extension.functions) {
                extensionSet.addFunction(function_);
            }
            // tests
            for (const test of extension.tests) {
                extensionSet.addTest(test);
            }
            // operators
            for (const operator of extension.operators) {
                extensionSet.addOperator(operator);
            }
            // tag handlers
            for (const tagHandler of extension.tagHandlers) {
                extensionSet.addTagHandler(tagHandler);
            }
            // node visitors
            for (const nodeVisitor of extension.nodeVisitors) {
                extensionSet.addNodeVisitor(nodeVisitor);
            }
        },
        addFilter: (filter) => {
            filters.set(filter.name, filter);
        },
        addFunction: (twingFunction) => {
            functions.set(twingFunction.name, twingFunction);
        },
        addNodeVisitor: (nodeVisitor) => {
            nodeVisitors.push(nodeVisitor);
        },
        addOperator: (operator) => {
            let bucket;
            if (operator.type === "UNARY") {
                bucket = unaryOperators;
            }
            else {
                bucket = binaryOperators;
            }
            bucket.push(operator);
        },
        addTagHandler: (tagHandler) => {
            tagHandlers.push(tagHandler);
        },
        addTest: (test) => {
            tests.set(test.name, test);
        }
    };
    return extensionSet;
};

const createNodeTraverser = (visitors) => {
    const traverseWithVisitor = (visitor, node, source) => {
        node = visitor.enterNode(node, source);
        for (const [key, child] of getChildren(node)) {
            const newChild = traverseWithVisitor(visitor, child, source);
            if (newChild) {
                if (newChild !== child) {
                    node.children[key] = newChild;
                }
            }
            else {
                delete node.children[key];
            }
        }
        return visitor.leaveNode(node, source);
    };
    return (node, template) => {
        let result = node;
        for (const visitor of visitors) {
            result = traverseWithVisitor(visitor, node, template);
        }
        return result;
    };
};

const createTokenStream = (tokens, source) => {
    const stream = new twigLexer.TokenStream(tokens);
    const tokenStream = {
        get current() {
            return stream.current;
        },
        get source() {
            return source;
        },
        injectTokens: (tokens) => {
            stream.injectTokens(tokens);
        },
        next: () => {
            return stream.next();
        },
        nextIf: (primary, secondary) => {
            return stream.nextIf(primary, secondary);
        },
        expect: (type, value = null, message = null) => {
            let token = tokenStream.current;
            if (!token.test(type, value || undefined)) {
                const { line, column } = token;
                throw createParsingError(`${message ? message + '. ' : ''}Unexpected token "${typeToEnglish(token.type)}" of value "${token.value}" ("${typeToEnglish(type)}" expected${value ? ` with value "${value}"` : ''}).`, { line, column }, source);
            }
            tokenStream.next();
            return token;
        },
        look: (number) => {
            return stream.look(number);
        },
        test: (type, value) => {
            return stream.test(type, value);
        },
        isEOF: () => {
            return tokenStream.current.type === "EOF";
        },
        toAst: () => {
            return stream.traverse((token, stream) => {
                token = twigLexer.astVisitor(token, stream);
                if (token && token.test("TEST_OPERATOR")) {
                    token = new twigLexer.Token("OPERATOR", token.value, token.line, token.column);
                }
                return token;
            });
        }
    };
    return tokenStream;
};

/**
 * Lexes a template string.
 */
const typeToEnglish = (type) => {
    switch (type) {
        case "EOF":
            return 'end of template';
        case "TEXT":
            return 'text';
        case "TAG_START":
            return 'begin of statement block';
        case "VARIABLE_START":
            return 'begin of print statement';
        case "TAG_END":
            return 'end of statement block';
        case "VARIABLE_END":
            return 'end of print statement';
        case "NAME":
            return 'name';
        case "NUMBER":
            return 'number';
        case "STRING":
            return 'string';
        case "OPERATOR":
            return 'operator';
        case "PUNCTUATION":
            return 'punctuation';
        case "INTERPOLATION_START":
            return 'begin of string interpolation';
        case "INTERPOLATION_END":
            return 'end of string interpolation';
        case "COMMENT_START":
            return 'begin of comment statement';
        case "COMMENT_END":
            return 'end of comment statement';
        case "ARROW":
            return 'arrow function';
        case "SPREAD_OPERATOR":
            return 'spread operator';
        default:
            throw new Error(`Token of type "${type}" does not exist.`);
    }
};
class TwingLexer extends twigLexer.Lexer {
    constructor(level, binaryOperators, unaryOperators) {
        super(level);
        // custom operators
        for (const operators of [binaryOperators, unaryOperators]) {
            for (const { name } of operators) {
                if (!this.operators.includes(name)) {
                    this.operators.push(name);
                }
            }
        }
    }
    tokenizeSource(source) {
        try {
            const tokens = this.tokenize(source.code);
            return createTokenStream(tokens, source);
        }
        catch (error) {
            const { message, line, column } = error;
            throw createParsingError(message, { line, column }, source, error);
        }
    }
}
const createLexer = (level, binaryOperators, unaryOperators) => {
    const keepCompatibleOperator = (operator) => operator.specificationLevel <= level;
    return new TwingLexer(level, binaryOperators.filter(keepCompatibleOperator), unaryOperators.filter(keepCompatibleOperator));
};

const createCoreNodeVisitor = () => {
    const enteredNodes = [];
    const enterDefaultFilterNode = (node) => {
        const { line, column } = node;
        const { arguments: methodArguments } = node.children;
        const operand = node.children.operand;
        let newNode;
        if (operand.type === "name" || operand.type === "attribute_accessor") {
            const testNode = createTestNode(operand, "defined", createArrayNode([], line, column), line, column);
            const values = getKeyValuePairs(methodArguments).map(({ value }) => value);
            const falseNode = values.length > 0 ? values[0] : createConstantNode('', line, column);
            newNode = createConditionalNode(testNode, node, falseNode, line, column);
        }
        else {
            newNode = node;
        }
        return newNode;
    };
    const enterDefinedTestNode = (node, source) => {
        const operand = node.children.operand;
        if (operand.type !== "name" &&
            operand.type !== "attribute_accessor" &&
            operand.type !== "block_function" &&
            operand.type !== "constant" &&
            operand.type !== "array" &&
            operand.type !== "hash" &&
            operand.type !== "method_call" &&
            !(operand.type === "function" && operand.attributes.operatorName === 'constant')) {
            throw createParsingError('The "defined" test only works with simple variables.', node, source);
        }
        let newOperand;
        if (operand.type === "block_function") {
            const blockReferenceExpressionNode = cloneBlockReferenceExpressionNode(operand);
            blockReferenceExpressionNode.attributes.shouldTestExistence = true;
            newOperand = blockReferenceExpressionNode;
        }
        else if (operand.type === "constant" || operand.type === "array") {
            newOperand = createConstantNode(true, operand.line, operand.column);
        }
        else if (operand.type === "name") {
            const nameNode = cloneNameNode(operand);
            nameNode.attributes.shouldTestExistence = true;
            newOperand = nameNode;
        }
        else if (operand.type === "method_call") {
            const methodCallNode = cloneMethodCallNode(operand);
            methodCallNode.attributes.shouldTestExistence = true;
            newOperand = methodCallNode;
        }
        else if (operand.type === "attribute_accessor") {
            const getAttributeNode = cloneGetAttributeNode(operand);
            getAttributeNode.attributes.shouldTestExistence = true;
            const traverse = (node) => {
                node.attributes.isOptimizable = false;
                node.attributes.shouldIgnoreStrictCheck = true;
                if (node.children.target.type === "attribute_accessor") {
                    const clonedTarget = cloneGetAttributeNode(node.children.target);
                    traverse(clonedTarget);
                    node.children.target = clonedTarget;
                }
            };
            traverse(getAttributeNode);
            newOperand = getAttributeNode;
        }
        else {
            newOperand = operand;
        }
        node.children.operand = newOperand;
        return node;
    };
    const leaveGetAttributeNode = (node) => {
        const { shouldIgnoreStrictCheck } = node.attributes;
        const { target } = node.children;
        if (shouldIgnoreStrictCheck) {
            if (target.type === "name") {
                const nameNode = cloneNameNode(target);
                nameNode.attributes.shouldIgnoreStrictCheck = true;
                node.children.target = nameNode;
            }
        }
        return node;
    };
    return {
        enterNode: (node, source) => {
            if (!enteredNodes.includes(node)) {
                enteredNodes.push(node);
                if (node.type === "filter") {
                    if (node.attributes.operatorName === "default") {
                        return enterDefaultFilterNode(node);
                    }
                }
                if (node.type === "test") {
                    if (node.attributes.operatorName === "defined") {
                        return enterDefinedTestNode(node, source);
                    }
                }
            }
            return node;
        },
        leaveNode: (node) => {
            if (node.type === "attribute_accessor") {
                return leaveGetAttributeNode(node);
            }
            return node;
        }
    };
};

/**
 * Convenient factory for TwingNodeVisitor
 */
const createNodeVisitor = (enterNode, leaveNode) => {
    return {
        enterNode,
        leaveNode
    };
};

const createSandboxNodeVisitor = () => {
    let tags;
    let filters;
    let functions;
    let shouldWrap = true;
    const enterNode = (node) => {
        if (node.type === "template") {
            tags = new Map();
            filters = new Map();
            functions = new Map();
            return node;
        }
        else {
            // look for tags
            const { tag } = node;
            if (tag && !(tags.has(tag))) {
                tags.set(tag, node);
            }
            // look for filters
            if (node.type === "filter") {
                const { operatorName } = node.attributes;
                if (!filters.has(operatorName)) {
                    filters.set(operatorName, node);
                }
            }
            // look for functions
            if (node.type === "function") {
                const { operatorName } = node.attributes;
                if (!functions.has(operatorName)) {
                    functions.set(operatorName, node);
                }
            }
            // the .. operator is equivalent to the range() function
            if (node.type === "range" && !(functions.has('range'))) {
                functions.set('range', node);
            }
            if (node.type === "print") {
                shouldWrap = true;
                wrapNode(node, "expression");
            }
            if (node.type === "set") {
                shouldWrap = true;
            }
            if (shouldWrap) {
                if (node.type === "concatenate") {
                    wrapNode(node, "left");
                    wrapNode(node, "right");
                }
                if (node.type === "filter") {
                    wrapNode(node, "operand");
                    wrapArrayNode(node, "arguments");
                }
                if (node.type === "function") {
                    wrapArrayNode(node, "arguments");
                }
                if (node.type === "escape") {
                    wrapNode(node, "body");
                }
            }
        }
        return node;
    };
    const leaveNode = (node) => {
        if (node.type === "template") {
            node.children.securityCheck = createCheckSecurityNode(filters, tags, functions, node.line, node.column);
        }
        else if (node.type === "print" || node.type === "set") {
            shouldWrap = false;
        }
        return node;
    };
    const wrapNode = (node, name) => {
        const expression = node.children[name];
        if (expression.type === "name" || expression.type === "attribute_accessor") {
            node.children[name] = createCheckToStringNode(expression, expression.line, expression.column);
        }
    };
    const wrapArrayNode = (node, name) => {
        const args = node.children[name]; // todo: check with TS team with we have to cast children as any
        for (const [name] of getChildren(args)) {
            wrapNode(args, name);
        }
    };
    return createNodeVisitor(enterNode, leaveNode);
};

const createEscaperNodeVisitor = () => {
    const safes = new Map();
    const statusStack = [];
    let blocks = new Map();
    const analyze = (node) => {
        let isSafe = safes.get(node);
        if (isSafe === undefined) {
            if (node.type === "constant") {
                // constants are safe by definition
                isSafe = true;
            }
            else if (node.type === "block_function") {
                // blocks function is safe by definition
                isSafe = true;
            }
            else if (node.type === "parent_function") {
                // parent function is safe by definition
                isSafe = true;
            }
            else if (node.type === "conditional") {
                // intersect safeness of both operands
                const { expr2, expr3 } = node.children;
                isSafe = intersectSafe(analyze(expr2), analyze(expr3));
            }
            else {
                isSafe = node.type === "method_call";
            }
            safes.set(node, isSafe);
        }
        return isSafe;
    };
    const intersectSafe = (a, b) => {
        return a && b;
    };
    const needEscaping = () => {
        if (statusStack.length) {
            return statusStack[statusStack.length - 1];
        }
        return false;
    };
    const getEscapeNode = (type, node) => {
        return createEscapeNode(node, type);
    };
    const enterNode = (node) => {
        if (node.type === "template") {
            blocks = new Map();
        }
        else if (node.type === "auto_escape") {
            const { strategy } = node.attributes;
            statusStack.push(strategy);
        }
        else if (node.type === "block") {
            const blockStatus = blocks.get(node.attributes.name);
            statusStack.push(blockStatus !== undefined ? blockStatus : needEscaping());
        }
        return node;
    };
    const leaveNode = (node) => {
        if (node.type === "template") {
            blocks = new Map();
        }
        else if (node.type === "print") {
            const type = needEscaping();
            if (type !== false) {
                const expression = node.children.expression;
                if ((expression.type === "conditional" || expression.type === "nullish_coalescing") && shouldUnwrapConditional(expression)) {
                    return createDoNode(unwrapConditional(expression, type), expression.line, expression.column, null);
                }
                return escapePrintNode(node, type);
            }
        }
        if (node.type === "auto_escape" || node.type === "block") {
            statusStack.pop();
            if (node.type === "auto_escape") {
                return node.children.body;
            }
        }
        else if (node.type === "block_reference") {
            blocks.set(node.attributes.name, needEscaping());
        }
        return node;
    };
    const shouldUnwrapConditional = (expression) => {
        const { expr2, expr3 } = expression.children;
        const expr2IsSafe = isSafe(expr2);
        const expr3IsSafe = isSafe(expr3);
        return expr2IsSafe !== expr3IsSafe;
    };
    const unwrapConditional = (expression, type) => {
        // convert "echo a ? b : c" to "a ? echo b : echo c" recursively
        let { children } = expression;
        let expr1 = children.expr1;
        let expr2 = children.expr2;
        let expr3 = children.expr3;
        const wrapPrintNodeExpression = (node) => {
            const { expression } = node.children;
            if (isSafe(expression)) {
                return node;
            }
            return createPrintNode(getEscapeNode(type, expression), node.line, node.column);
        };
        if (expr2.type === "conditional" && shouldUnwrapConditional(expr2)) {
            expr2 = unwrapConditional(expr2, type);
        }
        else {
            expr2 = wrapPrintNodeExpression(createPrintNode(expr2, expr2.line, expr2.column));
        }
        if (expr3.type === "conditional" && shouldUnwrapConditional(expr3)) {
            expr3 = unwrapConditional(expr3, type);
        }
        else {
            expr3 = wrapPrintNodeExpression(createPrintNode(expr3, expr3.line, expr3.column));
        }
        return createConditionalNode(expr1, expr2, expr3, expression.line, expression.column);
    };
    const escapePrintNode = (node, type) => {
        const { expression } = node.children;
        if (isSafe(expression)) {
            return node;
        }
        return createPrintNode(getEscapeNode(type, expression), node.line, node.column);
    };
    const isSafe = (expression) => {
        let safe = safes.get(expression);
        if (safe === undefined) {
            safe = analyze(expression);
        }
        return safe;
    };
    return createNodeVisitor(enterNode, leaveNode);
};

const nameRegExp = new RegExp(twigLexer.namePattern);
const getNames = (map) => {
    return [...map.values()].map(({ name }) => name);
};
const createParser = (unaryOperators, binaryOperators, additionalTagHandlers, visitors, filters, functions, tests, options) => {
    const strict = (options === null || options === void 0 ? void 0 : options.strict) !== undefined ? options.strict : true;
    const level = (options === null || options === void 0 ? void 0 : options.level) || 3;
    // operators
    const binaryOperatorsRegister = new Map(binaryOperators
        .filter((operator) => operator.specificationLevel <= level)
        .map((operator) => [operator.name, operator]));
    const unaryOperatorsRegister = new Map(unaryOperators
        .map((operator) => [operator.name, operator]));
    // tag handlers
    const tagHandlers = [
        createApplyTagHandler(),
        createAutoEscapeTagHandler(),
        createBlockTagHandler(),
        createDeprecatedTagHandler(),
        createDoTagHandler(),
        createEmbedTagHandler(),
        createExtendsTagHandler(),
        createFlushTagHandler(),
        createForTagHandler(),
        createFromTagHandler(),
        createIfTagHandler(),
        createImportTagHandler(),
        createIncludeTagHandler(),
        createLineTagHandler(),
        createMacroTagHandler(),
        createSandboxTagHandler(),
        createSetTagHandler(),
        createUseTagHandler(),
        createVerbatimTagHandler(),
        createWithTagHandler()
    ];
    if (level === 2) {
        tagHandlers.push(...[
            createFilterTagHandler(),
            createSpacelessTagHandler(),
        ]);
    }
    tagHandlers.push(...additionalTagHandlers);
    const tokenParsers = new Map();
    let varNameSalt = 0;
    let parent = null;
    let blocks = {};
    let blockStack = [];
    let macros = {};
    let importedSymbols = [{
            method: new Map(),
            template: []
        }];
    let traits = {};
    let embeddedTemplates = [];
    let embeddedTemplateIndex = 1;
    const filterNames = getNames(filters);
    const functionNames = getNames(functions);
    const testNames = getNames(tests);
    const tags = tagHandlers.map(({ tag }) => tag);
    const stack = [];
    const addImportedSymbol = (type, alias, name, node) => {
        const localScope = importedSymbols[0];
        if (type === "method") {
            localScope[type].set(alias, {
                name: name,
                node: node
            });
        }
        else {
            localScope[type].push(alias);
        }
    };
    const addTrait = (trait) => {
        pushToRecord(traits, trait);
    };
    // checks that the node only contains "constant" elements
    const checkConstantExpression = (stackEntry, node) => {
        if (!(node.type === "constant"
            || node.type === "array"
            || node.type === "hash"
            || node.type === "negative"
            || node.type === "positive")) {
            return node;
        }
        for (const [, child] of getChildren(node)) {
            if (checkConstantExpression(stackEntry, child) !== null) {
                return child;
            }
        }
        return null;
    };
    const embedTemplate = (template) => {
        template.attributes.index = embeddedTemplateIndex++;
        embeddedTemplates.push(template);
    };
    const filterChildBodyNode = (stream, node, nested = false) => {
        // non-empty text nodes are not allowed as direct child of a 
        const testedNode = node;
        if (testedNode.type === "text" && !isMadeOfWhitespaceOnly(testedNode.attributes.data)) {
            const { data } = testedNode.attributes;
            if (data.indexOf(String.fromCharCode(0xEF, 0xBB, 0xBF)) > -1) {
                const trailingData = data.substring(3);
                if (trailingData === '' || isMadeOfWhitespaceOnly(trailingData)) {
                    // bypass empty nodes starting with a BOM
                    return null;
                }
            }
            throw createParsingError(`A template that extends another one cannot include content outside Twig blocks. Did you forget to put the content inside a {% block %} tag?`, node, stream.source);
        }
        const { type } = node;
        // bypass nodes that "capture" the output
        if (type === "set") {
            return node;
        }
        // to be removed completely in Twig 3.0
        if (!nested && (type === "spaceless")) {
            console.warn(`Using the spaceless tag at the root level of a child template in "${stream.source.name}" at line ${node.line} is deprecated since Twig 2.5.0 and will become a syntax error in Twig 3.0.`);
        }
        // "block" tags that are not capturing (see above) are only used for defining
        // the content of the block. In such a case, nesting it does not work as
        // expected as the definition is not part of the default template code flow.
        if (nested && (type === "block_reference")) {
            if (level >= 3) {
                throw createParsingError(`A block definition cannot be nested under non-capturing nodes.`, node, stream.source);
            }
            else {
                console.warn(`Nesting a block definition under a non-capturing node in "${stream.source.name}" at line ${node.line} is deprecated since Twig 2.5.0 and will become a syntax error in Twig 3.0.`);
                return null;
            }
        }
        if (type === "block_reference" || type === "print" || type === "text") {
            return null;
        }
        // here, nested means "being at the root level of a child template"
        // we need to discard the wrapping node for the "body" node
        nested = nested || (type !== null);
        for (const [key, child] of getChildren(node)) {
            if (child !== null && (filterChildBodyNode(stream, child, nested) === null)) {
                delete node.children[key];
            }
        }
        return node;
    };
    const getBlock = (name) => {
        return blocks[name] || null;
    };
    const getBlockStack = () => {
        return blockStack;
    };
    const getFilterExpressionFactory = (stream, name, line, column) => {
        const filter = getFilter(filters, name);
        if (filter) {
            if (filter.isDeprecated) {
                let message = `Filter "${filter.name}" is deprecated`;
                if (filter.deprecatedVersion !== true) {
                    message += ` since version ${filter.deprecatedVersion}`;
                }
                if (filter.alternative) {
                    message += `. Use "${filter.alternative}" instead`;
                }
                let src = stream.source;
                message += ` in "${src.name}" at line ${line}.`;
                console.warn(message);
            }
        }
        else if (strict) {
            const error = createParsingError(`Unknown filter "${name}".`, { line, column }, stream.source);
            error.addSuggestions(name, filterNames);
            throw error;
        }
        return createFilterNode;
    };
    const getFunctionExpressionFactory = (stream, name, line, column) => {
        const twingFunction = getFunction(functions, name);
        if (twingFunction) {
            if (twingFunction.isDeprecated) {
                let message = `Function "${twingFunction.name}" is deprecated`;
                if (twingFunction.deprecatedVersion !== true) {
                    message += ` since version ${twingFunction.deprecatedVersion}`;
                }
                if (twingFunction.alternative) {
                    message += `. Use "${twingFunction.alternative}" instead`;
                }
                const source = stream.source;
                message += ` in "${source.name}" at line ${line}.`;
                console.warn(message);
            }
        }
        else if (strict) {
            const error = createParsingError(`Unknown function "${name}".`, { line, column }, stream.source);
            error.addSuggestions(name, functionNames);
            throw error;
        }
        return createFunctionNode;
    };
    const getFunctionNode = (stream, name, line, column) => {
        switch (name) {
            case 'parent':
                parseArguments(stream);
                if (!getBlockStack().length) {
                    throw createParsingError('Calling "parent" outside a block is forbidden.', {
                        line,
                        column
                    }, stream.source);
                }
                if (!parent && !hasTraits()) {
                    throw createParsingError('Calling "parent" on a template that does not extend nor "use" another template is forbidden.', {
                        line,
                        column
                    }, stream.source);
                }
                return createParentFunctionNode(peekBlockStack(), line, column);
            case 'block':
                const blockArgs = parseArguments(stream);
                const keyValuePairs = getKeyValuePairs(blockArgs);
                if (keyValuePairs.length < 1) {
                    throw createParsingError('The "block" function takes one argument (the block name).', {
                        line,
                        column
                    }, stream.source);
                }
                return createBlockFunctionNode(keyValuePairs[0].value, keyValuePairs.length > 1 ? keyValuePairs[1].value : null, line, column);
            case 'attribute':
                const attributeArgs = parseArguments(stream);
                const attributeKeyValuePairs = getKeyValuePairs(attributeArgs);
                if (attributeKeyValuePairs.length < 2) {
                    throw createParsingError('The "attribute" function takes at least two arguments (the variable and the attributes).', {
                        line,
                        column
                    }, stream.source);
                }
                return createAttributeAccessorNode(attributeKeyValuePairs[0].value, attributeKeyValuePairs[1].value, attributeKeyValuePairs.length > 2 ? attributeKeyValuePairs[2].value : createArrayNode([], line, column), "any", line, column);
            default:
                const alias = getImportedMethod(name);
                if (alias) {
                    const argumentsNode = parseArguments(stream);
                    const node = createMethodCallNode(alias.node, alias.name, argumentsNode, line, column);
                    return node;
                }
                const aliasArguments = parseArguments(stream, true);
                const aliasFactory = getFunctionExpressionFactory(stream, name, line, column);
                return aliasFactory(name, aliasArguments, line, column);
        }
    };
    const getImportedMethod = (alias) => {
        let result;
        const testImportedSymbol = (importedSymbol) => {
            const importedSymbolType = importedSymbol["method"];
            if (importedSymbolType && importedSymbolType.has(alias)) {
                return importedSymbolType.get(alias);
            }
            return null;
        };
        result = testImportedSymbol(importedSymbols[0]) || null;
        // if the symbol does not exist in the current scope (0), try in the main/global scope (last index)
        let length = importedSymbols.length;
        if (!result && (length > 1)) {
            result = testImportedSymbol(importedSymbols[length - 1]) || null;
        }
        return result;
    };
    const getImportedTemplate = (alias) => {
        let result;
        const testImportedSymbol = (importedSymbol) => {
            const importedSymbolType = importedSymbol["template"];
            if (importedSymbolType && importedSymbolType.includes(alias)) {
                return alias;
            }
            return null;
        };
        result = testImportedSymbol(importedSymbols[0]) || null;
        // if the symbol does not exist in the current scope (0), try in the main/global scope (last index)
        let length = importedSymbols.length;
        if (!result && (length > 1)) {
            result = testImportedSymbol(importedSymbols[length - 1]) || null;
        }
        return result;
    };
    const getPrimary = (stream) => {
        let token = stream.current;
        let operator;
        if ((operator = isUnary(token)) !== null) {
            stream.next();
            const expression = parseExpression(stream, operator.precedence);
            const expressionFactory = operator.expressionFactory;
            return parsePostfixExpression(stream, expressionFactory([expression, createNode()], token.line, token.column), token);
        }
        else if (token.test("PUNCTUATION", '(')) {
            stream.next();
            const expression = parseExpression(stream);
            stream.expect("PUNCTUATION", ')', 'An opened parenthesis is not properly closed');
            return parsePostfixExpression(stream, expression, token);
        }
        return parsePrimaryExpression(stream);
    };
    const getTestName = (stream) => {
        const { line, column } = stream.current;
        let name = stream.expect("NAME").value;
        let test = getTest(tests, name);
        if (!test) {
            if (stream.test("NAME")) {
                // try 2-words tests
                name = name + ' ' + stream.current.value;
                test = getTest(tests, name);
                if (test) {
                    stream.next();
                }
                else {
                    // non-existing two-words test
                    if (!strict) {
                        stream.next();
                        test = {
                            name,
                            isDeprecated: false,
                            alternative: undefined,
                            deprecatedVersion: undefined
                        };
                    }
                }
            }
            else {
                // non-existing one-word test
                if (!strict) {
                    test = {
                        name,
                        isDeprecated: false,
                        alternative: undefined,
                        deprecatedVersion: undefined
                    };
                }
            }
        }
        if (test) {
            if (test.isDeprecated) {
                let message = `Test "${test.name}" is deprecated`;
                if (test.deprecatedVersion !== true) {
                    message += ` since version ${test.deprecatedVersion}`;
                }
                if (test.alternative) {
                    message += `. Use "${test.alternative}" instead`;
                }
                const source = stream.source;
                message += ` in "${source.name}" at line ${line}.`;
                console.warn(message);
            }
            return name;
        }
        const error = createParsingError(`Unknown test "${name}".`, { line, column }, stream.source);
        error.addSuggestions(name, testNames);
        throw error;
    };
    const getVarName = (prefix = '__internal_') => {
        return `${prefix}${varNameSalt++}`;
    };
    const hasTraits = () => {
        return Object.keys(traits).length > 0;
    };
    const isBinary = (token) => {
        if (token.value === "is" || token.value === "is not") {
            return {
                expressionFactory: null,
                name: token.value,
                precedence: 100
            };
        }
        return (token.test("OPERATOR") && binaryOperatorsRegister.get(token.value)) || null;
    };
    const isUnary = (token) => {
        return (token.test("OPERATOR") && unaryOperatorsRegister.get(token.value)) || null;
    };
    const parse = (stream, tag = null, test = null) => {
        stack.push({
            stream,
            parent,
            blocks,
            blockStack,
            macros,
            importedSymbols,
            traits,
            embeddedTemplates
        });
        parent = null;
        blocks = {};
        macros = {};
        traits = {};
        blockStack = [];
        importedSymbols = [{
                method: new Map(),
                template: []
            }];
        embeddedTemplates = [];
        let body = subparse(stream, tag, test);
        if (parent !== null && (body = filterChildBodyNode(stream, body)) === null) {
            body = createNode();
        }
        let node = createTemplateNode(body, parent, createNode(blocks), createNode(macros), createNode(traits), embeddedTemplates, stream.source, 1, 1);
        // passed visitors
        let traverse = createNodeTraverser(visitors);
        node = traverse(node, stream.source);
        // core visitors
        traverse = createNodeTraverser([
            createCoreNodeVisitor(),
            createEscaperNodeVisitor(),
            createSandboxNodeVisitor()
        ]);
        node = traverse(node, stream.source);
        // restore previous stack so previous parse() call can resume working
        const previousStackEntry = stack.pop();
        parent = previousStackEntry.parent;
        blocks = previousStackEntry.blocks;
        macros = previousStackEntry.macros;
        traits = previousStackEntry.traits;
        blockStack = previousStackEntry.blockStack;
        importedSymbols = previousStackEntry.importedSymbols;
        embeddedTemplates = previousStackEntry.embeddedTemplates;
        return node;
    };
    /**
     * Parses arguments.
     *
     * @param stream
     * @param namedArguments {boolean} Whether to allow named arguments or not
     * @param definition {boolean} Whether we are parsing arguments for a macro definition
     * @param allowArrow {boolean}
     *
     * @throws TwingErrorSyntax
     */
    const parseArguments = (stream, namedArguments = false, definition = false, allowArrow) => {
        var _a;
        const { line, column } = stream.current;
        const elements = [];
        let value;
        let token;
        stream.expect("PUNCTUATION", '(');
        while (!stream.test("PUNCTUATION", ')')) {
            if (elements.length > 0) {
                stream.expect("PUNCTUATION", ',');
            }
            if (definition) {
                token = stream.expect("NAME", null);
                const { line, column } = stream.current;
                value = createNameNode(token.value, line, column);
            }
            else {
                value = parseExpression(stream, 0, allowArrow);
            }
            let key = undefined;
            if (namedArguments && (token = ((_a = stream.nextIf("OPERATOR", '=')) !== null && _a !== void 0 ? _a : stream.nextIf("PUNCTUATION", ':')))) {
                if (value.type !== "name") {
                    throw createParsingError(`A parameter name must be a string, "${value.type.toString()}" given.`, value, stream.source);
                }
                key = createConstantNode(value.attributes.name, value.line, value.column);
                if (definition) {
                    value = parsePrimaryExpression(stream);
                    const notConstantNode = checkConstantExpression(stream, value);
                    if (notConstantNode !== null) {
                        throw createParsingError(`A default value for an argument must be a constant (a boolean, a string, a number, or an array).`, notConstantNode, stream.source);
                    }
                }
                else {
                    value = parseExpression(stream, 0, allowArrow);
                }
            }
            if (definition) {
                if (key === undefined) {
                    key = createConstantNode(value.attributes.name, line, column);
                    value = createConstantNode(null, line, column);
                }
            }
            elements.push({
                key,
                value
            });
        }
        stream.expect("PUNCTUATION", ')');
        const arrayNode = createArrayNode(elements, line, column);
        return arrayNode;
    };
    const parseArrayExpression = (stream) => {
        const { line, column } = stream.current;
        stream.expect("PUNCTUATION", '[', 'An array element was expected');
        const elements = [];
        let first = true;
        while (!stream.test("PUNCTUATION", ']')) {
            if (!first) {
                stream.expect("PUNCTUATION", ',', 'An array element must be followed by a comma');
                // trailing ,?
                if (stream.test("PUNCTUATION", ']')) {
                    break;
                }
            }
            first = false;
            if (stream.test("SPREAD_OPERATOR")) {
                const { current } = stream;
                stream.next();
                const expression = parseExpression(stream);
                const spreadNode = createSpreadNode(expression, current.line, current.column);
                elements.push(spreadNode);
            }
            else {
                elements.push(parseExpression(stream));
            }
        }
        stream.expect("PUNCTUATION", ']', 'An opened array is not properly closed');
        return createArrayNode(elements.map((element) => {
            return {
                value: element
            };
        }), line, column);
    };
    const parseAssignmentExpression = (stream) => {
        const targets = {};
        const { line, column } = stream.current;
        while (true) {
            let token = stream.current;
            if (stream.test("OPERATOR") && nameRegExp.exec(token.value)) {
                // in this context, string operators are variable names
                stream.next();
            }
            else {
                stream.expect("NAME", null, 'Only variables can be assigned to');
            }
            let value = token.value;
            if (['true', 'false', 'none', 'null'].indexOf(value.toLowerCase()) > -1) {
                throw createParsingError(`You cannot assign a value to "${value}".`, token, stream.source);
            }
            pushToRecord(targets, createAssignmentNode(value, token.line, token.column));
            if (!stream.nextIf("PUNCTUATION", ',')) {
                break;
            }
        }
        return createNode(targets, line, column);
    };
    const parseArrow = (stream) => {
        let token;
        let line;
        let column;
        let names;
        // short array syntax (one argument, no parentheses)?
        if (stream.look(1).test("ARROW")) {
            line = stream.current.line;
            column = stream.current.column;
            token = stream.expect("NAME");
            names = {
                0: createAssignmentNode(token.value, token.line, token.column)
            };
            stream.expect("ARROW");
            return createArrowFunctionNode(parseExpression(stream, 0), createNode(names), line, column);
        }
        // first, determine if we are parsing an arrow function by finding => (long form)
        let i = 0;
        if (!stream.look(i).test("PUNCTUATION", '(')) {
            return null;
        }
        ++i;
        while (true) {
            // variable name
            ++i;
            if (!stream.look(i).test("PUNCTUATION", ',')) {
                break;
            }
            ++i;
        }
        stream.look(i).test("PUNCTUATION", ')');
        ++i;
        if (!stream.look(i).test("ARROW")) {
            return null;
        }
        // yes, let's parse it properly
        token = stream.expect("PUNCTUATION", '(');
        line = token.line;
        column = token.column;
        names = {};
        i = 0;
        while (true) {
            token = stream.current;
            if (!token.test("NAME")) {
                throw createParsingError(`Unexpected token "${typeToEnglish(token.type)}" of value "${token.value}".`, token, stream.source);
            }
            names[i++] = createAssignmentNode(token.value, token.line, token.column);
            stream.next();
            if (!stream.nextIf("PUNCTUATION", ',')) {
                break;
            }
        }
        stream.expect("PUNCTUATION", ')');
        stream.expect("ARROW");
        return createArrowFunctionNode(parseExpression(stream, 0), createNode(names), line, column);
    };
    const parseConditionalExpression = (stream, expression) => {
        let expr2;
        let expr3;
        while (stream.nextIf("PUNCTUATION", '?')) {
            if (!stream.nextIf("PUNCTUATION", ':')) {
                expr2 = parseExpression(stream);
                if (stream.nextIf("PUNCTUATION", ':')) {
                    expr3 = parseExpression(stream);
                }
                else {
                    const { line, column } = stream.current;
                    expr3 = createConstantNode('', line, column);
                }
            }
            else {
                expr2 = expression;
                expr3 = parseExpression(stream);
            }
            const { line, column } = stream.current;
            expression = createConditionalNode(expression, expr2, expr3, line, column);
        }
        return expression;
    };
    const parseExpression = (stream, precedence = 0, allowArrow = undefined) => {
        if (allowArrow) {
            const arrow = parseArrow(stream);
            if (arrow) {
                return arrow;
            }
        }
        let expression = getPrimary(stream);
        let token = stream.current;
        let operator = null;
        while (((operator = isBinary(token)) !== null && operator.precedence >= precedence)) {
            stream.next();
            if (operator.expressionFactory === null) {
                expression = parseTestExpression(stream, expression);
                if (operator.name === "is not") {
                    const { line, column } = stream.current;
                    expression = createNotNode(expression, line, column);
                }
            }
            else {
                const { expressionFactory } = operator;
                const operand = parseExpression(stream, operator.associativity === "LEFT" ? operator.precedence + 1 : operator.precedence, true);
                expression = expressionFactory([expression, operand], token.line, token.column);
            }
            token = stream.current;
        }
        if (precedence === 0) {
            return parseConditionalExpression(stream, expression);
        }
        return expression;
    };
    const parseFilterExpression = (stream, node) => {
        stream.next();
        return parseFilterExpressionRaw(stream, node);
    };
    const parseFilterDefinitions = (stream) => {
        const definitions = [];
        while (true) {
            const token = stream.expect("NAME");
            const { value, line, column } = token;
            getFilterExpressionFactory(stream, value, token.line, token.column);
            let methodArguments;
            if (!stream.test("PUNCTUATION", '(')) {
                methodArguments = createArrayNode([], line, column);
            }
            else {
                methodArguments = parseArguments(stream, true, false, true);
            }
            definitions.unshift({
                name: value,
                arguments: methodArguments
            });
            if (!stream.test("PUNCTUATION", '|')) {
                break;
            }
            stream.next();
        }
        return definitions;
    };
    const parseFilterExpressionRaw = (stream, operand) => {
        let filterNode = null;
        while (true) {
            const token = stream.expect("NAME");
            const { value, line, column } = token;
            let methodArguments;
            if (!stream.test("PUNCTUATION", '(')) {
                methodArguments = createArrayNode([], line, column);
            }
            else {
                methodArguments = parseArguments(stream, true, false, true);
            }
            const factory = getFilterExpressionFactory(stream, value, line, column);
            if (filterNode === null) {
                filterNode = factory(operand, value, methodArguments, token.line, token.column);
            }
            else {
                filterNode = factory(filterNode, value, methodArguments, token.line, token.column);
            }
            if (!stream.test("PUNCTUATION", '|')) {
                break;
            }
            stream.next();
        }
        return filterNode;
    };
    const parseHashExpression = (stream) => {
        stream.expect("PUNCTUATION", '{', 'A hash element was expected');
        let first = true;
        const elements = [];
        while (!stream.test("PUNCTUATION", '}')) {
            if (!first) {
                stream.expect("PUNCTUATION", ',', 'A hash value must be followed by a comma');
                // trailing ,?
                if (stream.test("PUNCTUATION", '}')) {
                    break;
                }
            }
            first = false;
            if (stream.test("SPREAD_OPERATOR")) {
                const { current } = stream;
                stream.next();
                const expression = parseExpression(stream);
                const spreadNode = createSpreadNode(expression, current.line, current.column);
                elements.push({
                    key: createNode(),
                    value: spreadNode
                });
                continue;
            }
            // a hash key can be:
            //
            //  * a number -- 12
            //  * a string -- 'a'
            //  * a name, which is equivalent to a string -- a
            //  * an expression, which must be enclosed in parentheses -- (1 + 2)
            let token;
            let key;
            if (token = stream.nextIf("NAME")) {
                key = createConstantNode(token.value, token.line, token.column);
                // {a} is a shortcut for {a:a}
                if (stream.test("PUNCTUATION", [',', '}'])) {
                    elements.push({
                        key,
                        value: createNameNode(token.value, token.line, token.column)
                    });
                    continue;
                }
            }
            else if ((token = stream.nextIf("STRING")) || (token = stream.nextIf("NUMBER"))) {
                key = createConstantNode(token.value, token.line, token.column);
            }
            else if (stream.test("PUNCTUATION", '(')) {
                key = parseExpression(stream);
            }
            else {
                const { type, line, value, column } = stream.current;
                throw createParsingError(`A hash key must be a quoted string, a number, a name, or an expression enclosed in parentheses (unexpected token "${typeToEnglish(type)}" of value "${value}".`, {
                    line,
                    column
                }, stream.source);
            }
            stream.expect("PUNCTUATION", ':', 'A hash key must be followed by a colon (:)');
            const value = parseExpression(stream);
            elements.push({
                key,
                value
            });
        }
        stream.expect("PUNCTUATION", '}', 'An opened hash is not properly closed');
        return createHashNode(elements, stream.current.line, stream.current.column);
    };
    const parseMultiTargetExpression = (stream) => {
        const { line, column } = stream.current;
        const targets = {};
        while (true) {
            pushToRecord(targets, parseExpression(stream));
            if (!stream.nextIf("PUNCTUATION", ',')) {
                break;
            }
        }
        return createNode(targets, line, column);
    };
    const parsePostfixExpression = (stream, node, prefixToken) => {
        while (true) {
            let token = stream.current;
            if (token.type === "PUNCTUATION") {
                if (token.value === '.' || token.value === '[') {
                    node = parseSubscriptExpression(stream, node, prefixToken);
                }
                else if (token.value === '|') {
                    node = parseFilterExpression(stream, node);
                }
                else {
                    break;
                }
            }
            else {
                break;
            }
        }
        return node;
    };
    const parsePrimaryExpression = (stream) => {
        const token = stream.current;
        let node;
        switch (token.type) {
            case "NAME":
                stream.next();
                switch (token.value) {
                    case 'true':
                    case 'TRUE':
                        node = createConstantNode(true, token.line, token.column);
                        break;
                    case 'false':
                    case 'FALSE':
                        node = createConstantNode(false, token.line, token.column);
                        break;
                    case 'none':
                    case 'NONE':
                    case 'null':
                    case 'NULL':
                        node = createConstantNode(null, token.line, token.column);
                        break;
                    default:
                        if ('(' === stream.current.value) {
                            node = getFunctionNode(stream, token.value, token.line, token.column);
                        }
                        else {
                            node = createNameNode(token.value, token.line, token.column);
                        }
                }
                break;
            case "NUMBER":
                stream.next();
                node = createConstantNode(token.value, token.line, token.column);
                break;
            case "STRING":
            case "INTERPOLATION_START":
                node = parseStringExpression(stream);
                break;
            case "OPERATOR":
                let match = nameRegExp.exec(token.value);
                if (match !== null && match[0] === token.value) {
                    // in this context, string operators are variable names
                    stream.next();
                    node = createNameNode(token.value, token.line, token.column);
                    break;
                }
                else if (unaryOperatorsRegister.has(token.value)) {
                    const operator = unaryOperatorsRegister.get(token.value);
                    stream.next();
                    const expression = parsePrimaryExpression(stream);
                    const { expressionFactory } = operator;
                    node = expressionFactory([expression, createNode()], token.line, token.column);
                    break;
                }
            default:
                if (token.test("PUNCTUATION", '[')) {
                    node = parseArrayExpression(stream);
                }
                else if (token.test("PUNCTUATION", '{')) {
                    node = parseHashExpression(stream);
                }
                else if (token.test("OPERATOR", '=') && (stream.look(-1).value === '==' || stream.look(-1).value === '!=')) {
                    throw createParsingError(`Unexpected operator of value "${token.value}". Did you try to use "===" or "!==" for strict comparison? Use "is same as(value)" instead.`, token, stream.source);
                }
                else {
                    throw createParsingError(`Unexpected token "${typeToEnglish(token.type)}" of value "${token.value}".`, token, stream.source);
                }
        }
        return parsePostfixExpression(stream, node, token);
    };
    const parseStringExpression = (stream) => {
        const nodes = [];
        // a string cannot be followed by another string in a single expression
        let nextCanBeString = true;
        let token;
        while (true) {
            if (nextCanBeString && (token = stream.nextIf("STRING"))) {
                nodes.push(createConstantNode(token.value, token.line, token.column));
                nextCanBeString = false;
            }
            else if (stream.nextIf("INTERPOLATION_START")) {
                nodes.push(parseExpression(stream));
                stream.expect("INTERPOLATION_END");
                nextCanBeString = true;
            }
            else {
                break;
            }
        }
        let expression = nodes.shift();
        for (const node of nodes) {
            expression = createConcatenateNode([expression, node], node.line, node.column);
        }
        return expression;
    };
    const parseSubscriptExpression = (stream, node, prefixToken) => {
        let token = stream.next();
        let attribute;
        let type = "any";
        const { line, column } = token;
        const { line: prefixTokenLine, column: prefixTokenColumn } = prefixToken;
        const elements = [];
        const createArrayNodeFromElements = () => {
            return createArrayNode(elements.map((element) => {
                return {
                    value: element
                };
            }), line, column);
        };
        if (token.value === '.') {
            token = stream.next();
            let match = nameRegExp.exec(token.value);
            if ((token.type === "NAME") || (token.type === "NUMBER") || (token.type === "OPERATOR" && (match !== null))) {
                attribute = createConstantNode(token.value, line, column);
                if (stream.test("PUNCTUATION", '(')) {
                    type = "method";
                    const argumentsNode = parseArguments(stream);
                    for (const { value } of getKeyValuePairs(argumentsNode)) {
                        elements.push(value);
                    }
                }
            }
            else {
                throw createParsingError('Expected name or number.', { line, column: column + 1 }, stream.source);
            }
            if ((node.type === "name") && (node.attributes.name === '_self' || getImportedTemplate(node.attributes.name))) {
                const name = attribute.attributes.value;
                const methodCallNode = createMethodCallNode(node, name, createArrayNodeFromElements(), line, column);
                return methodCallNode;
            }
        }
        else {
            type = "array";
            // slice?
            let slice = false;
            if (stream.test("PUNCTUATION", ':')) {
                slice = true;
                attribute = createConstantNode(0, token.line, token.column);
            }
            else {
                attribute = parseExpression(stream);
            }
            if (stream.nextIf("PUNCTUATION", ':')) {
                slice = true;
            }
            if (slice) {
                let length;
                if (stream.test("PUNCTUATION", ']')) {
                    length = createConstantNode(null, token.line, token.column);
                }
                else {
                    length = parseExpression(stream);
                }
                const factory = getFilterExpressionFactory(stream, 'slice', token.line, token.column);
                const filterArguments = createArrayNode([
                    {
                        key: createConstantNode(0, line, column),
                        value: attribute
                    },
                    {
                        key: createConstantNode(1, line, column),
                        value: length
                    }
                ], 1, 1);
                const filter = factory(node, 'slice', filterArguments, token.line, token.column);
                stream.expect("PUNCTUATION", ']');
                return filter;
            }
            stream.expect("PUNCTUATION", ']');
        }
        return createAttributeAccessorNode(node, attribute, createArrayNodeFromElements(), type, prefixTokenLine, prefixTokenColumn);
    };
    const parseTestExpression = (stream, node) => {
        const { line, column } = stream.current;
        const name = getTestName(stream);
        let testArguments = createArrayNode([], line, column);
        if (stream.test("PUNCTUATION", '(')) {
            testArguments = parseArguments(stream, true);
        }
        if ((name === 'defined') && (node.type === "name")) {
            const alias = getImportedMethod(node.attributes.name);
            if (alias !== null) {
                node = createMethodCallNode(alias.node, alias.name, createArrayNode([], node.line, node.column), node.line, node.column);
            }
        }
        return createTestNode(node, name, testArguments, line, column);
    };
    const peekBlockStack = () => {
        return blockStack[blockStack.length - 1];
    };
    const popBlockStack = () => {
        blockStack.pop();
    };
    const popLocalScope = () => {
        importedSymbols.shift();
    };
    const pushBlockStack = (name) => {
        blockStack.push(name);
    };
    const pushLocalScope = () => {
        importedSymbols.unshift({
            method: new Map(),
            template: []
        });
    };
    const isMainScope = () => {
        return importedSymbols.length === 1;
    };
    const setBlock = (name, node) => {
        blocks[name] = node;
    };
    const setMacro = (name, node) => {
        macros[name] = node;
    };
    const subparse = (stream, tag, test) => {
        // token parsers
        if (tokenParsers.size === 0) {
            for (const handler of tagHandlers) {
                tokenParsers.set(handler.tag, handler.initialize(parser, level));
            }
        }
        let { line, column } = stream.current;
        let children = {};
        let i = 0;
        let token;
        while (!stream.isEOF()) {
            switch (stream.current.type) {
                case "TEXT":
                    token = stream.next();
                    children[i++] = createTextNode(token.value, token.line, token.column);
                    break;
                case "VARIABLE_START":
                    token = stream.next();
                    const expression = parseExpression(stream);
                    stream.expect("VARIABLE_END");
                    children[i++] = createPrintNode(expression, token.line, token.column);
                    break;
                case "TAG_START":
                    stream.next();
                    token = stream.current;
                    if (token.type !== "NAME") {
                        throw createParsingError('A block must start with a tag name.', token, stream.source);
                    }
                    if ((test !== null) && test(token)) {
                        if (Object.keys(children).length === 1) {
                            return children[0];
                        }
                        return createNode(children, line, column);
                    }
                    if (!tokenParsers.has(token.value)) {
                        let error;
                        if (test !== null) {
                            error = createParsingError(`Unexpected "${token.value}" tag`, token, stream.source);
                            error.appendMessage(` (expecting closing tag for the "${tag}" tag defined line ${line}).`);
                        }
                        else {
                            error = createParsingError(`Unknown "${token.value}" tag.`, token, stream.source);
                            error.addSuggestions(token.value, tags);
                        }
                        throw error;
                    }
                    stream.next();
                    const parseToken = tokenParsers.get(token.value);
                    const node = parseToken(token, stream);
                    if (node !== null) {
                        children[i++] = node;
                    }
                    break;
                case "COMMENT_START":
                    token = stream.next();
                    if (stream.test("TEXT")) {
                        // non-empty comment
                        token = stream.expect("TEXT");
                    }
                    stream.expect("COMMENT_END");
                    children[i++] = createCommentNode(token.value, token.line, token.column);
                    break;
            }
        }
        if (Object.keys(children).length === 1) {
            return children[0];
        }
        return createNode(children, line, column);
    };
    const parser = {
        addImportedSymbol,
        addTrait,
        embedTemplate,
        getBlock,
        getVarName,
        isMainScope,
        parse,
        parseArguments,
        parseAssignmentExpression,
        parseExpression,
        parseFilterExpressionRaw,
        parseFilterDefinitions,
        parseMultiTargetExpression,
        peekBlockStack,
        popBlockStack,
        popLocalScope,
        pushBlockStack,
        pushLocalScope,
        setBlock,
        setMacro,
        subparse,
        get parent() {
            return parent;
        },
        set parent(aParent) {
            parent = aParent;
        }
    };
    return parser;
};

const createHtmlEscapingStrategyHandler = () => {
    return (value) => {
        return strings.htmlspecialchars(value);
    };
};

const createCssEscapingStrategyHandler = () => {
    return (value) => {
        value = value.replace(/[^a-zA-Z0-9]/ug, (character) => {
            const codePoint = character.codePointAt(0);
            return phpSprintf('\\u%04X', codePoint);
        });
        return value;
    };
};

const createJsEscapingStrategyHandler = () => {
    return (value) => {
        // escape all non-alphanumeric characters
        // into their \x or \uHHHH representations
        value = value.replace(/[^a-zA-Z0-9,._]/ug, function (matches) {
            let char = matches;
            /**
             * A few characters have short escape sequences in JSON and JavaScript.
             * Escape sequences supported only by JavaScript, not JSON, are ommitted.
             * \" is also supported but omitted, because the resulting string is not HTML safe.
             */
            let shortMap = new Map([
                ['\\', '\\\\'],
                ['/', '\\/'],
                ["\x08", '\\b'],
                ["\x0C", '\\f'],
                ["\x0A", '\\n'],
                ["\x0D", '\\r'],
                ["\x09", '\\t'],
            ]);
            if (shortMap.has(char)) {
                return shortMap.get(char);
            }
            let codePoint = char.codePointAt(0);
            if (codePoint <= 0x10000) {
                return phpSprintf('\\u%04X', codePoint);
            }
            // Split characters outside the BMP into surrogate pairs
            // https://tools.ietf.org/html/rfc2781.html#section-2.1
            codePoint = codePoint - 0x10000;
            const high = 0xD800 | (codePoint >> 10);
            const low = 0xDC00 | (codePoint & 0x3FF);
            return phpSprintf('\\u%04X\\u%04X', high, low);
        });
        return value;
    };
};

const createUrlEscapingStrategyHandler = () => {
    return phpRawurlencode;
};

const createHtmlAttributeEscapingStrategyHandler = () => {
    return (value) => {
        value = value.replace(/[^a-zA-Z0-9,.\-_]/ug, function (matches) {
            /**
             * This function is adapted from code coming from Zend Framework.
             *
             * @copyright Copyright (c) 2005-2012 Zend Technologies USA Inc. (http://www.zend.com)
             * @license   http://framework.zend.com/license/new-bsd New BSD License
             */
            /*
             * While HTML supports far more named entities, the lowest common denominator
             * has become HTML5's XML Serialisation which is restricted to the those named
             * entities that XML supports. Using HTML entities would result in this error:
             *     XML Parsing Error: undefined entity
             */
            let entityMap = new Map([
                [34, 'quot'], /* quotation mark */
                [38, 'amp'], /* ampersand */
                [60, 'lt'], /* less-than sign */
                [62, 'gt'] /* greater-than sign */
            ]);
            let chr = matches;
            let ord = phpOrd(chr);
            /*
             * The following replaces characters undefined in HTML with the
             * hex entity for the Unicode replacement character.
             */
            if ((ord <= 0x1f && chr != "\t" && chr != "\n" && chr != "\r") || (ord >= 0x7f && ord <= 0x9f)) {
                return '&#xFFFD;';
            }
            /*
             * Check if the current character to escape has a name entity we should
             * replace it with while grabbing the hex value of the character.
             */
            let int = chr.codePointAt(0);
            if (entityMap.has(int)) {
                return `&${entityMap.get(int)};`;
            }
            let hex = int.toString(16).toUpperCase();
            if (hex.length === 1 || hex.length === 3) {
                hex = '0' + hex;
            }
            /*
             * Per OWASP recommendations, we'll use hex entities for any other
             * characters where a named entity does not exist.
             */
            return `&#x${hex};`;
        });
        return value;
    };
};

const createSourceMapRuntime = () => {
    let stack = [
        new sourceMap.SourceNode()
    ];
    return {
        get sourceMap() {
            const { map } = stack[0].toStringWithSourceMap();
            return JSON.parse(map.toString());
        },
        enterSourceMapBlock: (line, column, nodeType, source, outputBuffer) => {
            outputBuffer.start();
            let sourceName = source.name;
            if (Path.isAbsolute(sourceName)) {
                sourceName = Path.relative('.', sourceName);
            }
            const node = new sourceMap.SourceNode(line, column - 1, sourceName, '', nodeType);
            stack[0].setSourceContent(sourceName, source.code);
            stack.push(node);
        },
        leaveSourceMapBlock: (outputBuffer) => {
            const sourceNode = stack.pop();
            const content = outputBuffer.getAndFlush();
            if (sourceNode.children.length === 0) {
                sourceNode.add(content);
            }
            stack[stack.length - 1].add(sourceNode);
        }
    };
};

const createSandboxSecurityPolicy = (clearances) => {
    const allowedTags = (clearances === null || clearances === void 0 ? void 0 : clearances.allowedTags) || [];
    const allowedFilters = (clearances === null || clearances === void 0 ? void 0 : clearances.allowedFilters) || [];
    const allowedMethods = (clearances === null || clearances === void 0 ? void 0 : clearances.allowedMethods) || new Map();
    const allowedProperties = (clearances === null || clearances === void 0 ? void 0 : clearances.allowedProperties) || new Map();
    const allowedFunctions = (clearances === null || clearances === void 0 ? void 0 : clearances.allowedFunctions) || [];
    const policy = {
        checkMethodAllowed: (candidate, method) => {
            if (isAMarkup(candidate)) {
                return;
            }
            let allowed = false;
            for (const [constructorName, methods] of allowedMethods) {
                if (candidate instanceof constructorName) {
                    allowed = methods.includes(method);
                    break;
                }
            }
            if (!allowed) {
                const constructorName = candidate.constructor.name || '(anonymous)';
                throw new Error(`Calling "${method}" method on an instance of ${constructorName} is not allowed.`);
            }
        },
        checkPropertyAllowed: (candidate, property) => {
            let allowed = false;
            for (let [objectConstructor, properties] of allowedProperties) {
                if (candidate instanceof objectConstructor) {
                    allowed = properties.includes(property);
                    break;
                }
            }
            if (!allowed) {
                const constructorName = candidate.constructor.name || '(anonymous)';
                throw new Error(`Calling "${property}" property on an instance of ${constructorName} is not allowed.`);
            }
        },
        checkSecurity: (tags, filters, functions) => {
            for (const tagName of tags) {
                if (!allowedTags.includes(tagName)) {
                    return ({
                        message: `Tag "${tagName}" is not allowed.`,
                        token: tagName,
                        type: "tag"
                    });
                }
            }
            for (const filterName of filters) {
                if (!allowedFilters.includes(filterName)) {
                    return ({
                        message: `Filter "${filterName}" is not allowed.`,
                        token: filterName,
                        type: "filter"
                    });
                }
            }
            for (const functionName of functions) {
                if (!allowedFunctions.includes(functionName)) {
                    return ({
                        message: `Function "${functionName}" is not allowed.`,
                        token: functionName,
                        type: "function"
                    });
                }
            }
            return null;
        }
    };
    return policy;
};

const createCallableWrapper = (name, callable, acceptedArguments, options) => {
    let nativeArguments = [];
    const callableWrapper = {
        get callable() {
            return callable;
        },
        get name() {
            return name;
        },
        get acceptedArguments() {
            return acceptedArguments;
        },
        get alternative() {
            return options.alternative;
        },
        get deprecatedVersion() {
            return options.deprecated;
        },
        get isDeprecated() {
            return options.deprecated ? true : false;
        },
        get isVariadic() {
            return options.is_variadic || false;
        },
        get nativeArguments() {
            return nativeArguments;
        },
        set nativeArguments(values) {
            nativeArguments = values;
        }
    };
    return callableWrapper;
};
const createSynchronousCallableWrapper = (name, callable, acceptedArguments, options) => {
    let nativeArguments = [];
    const callableWrapper = {
        get callable() {
            return callable;
        },
        get name() {
            return name;
        },
        get acceptedArguments() {
            return acceptedArguments;
        },
        get alternative() {
            return options.alternative;
        },
        get deprecatedVersion() {
            return options.deprecated;
        },
        get isDeprecated() {
            return options.deprecated ? true : false;
        },
        get isVariadic() {
            return options.is_variadic || false;
        },
        get nativeArguments() {
            return nativeArguments;
        },
        set nativeArguments(values) {
            nativeArguments = values;
        }
    };
    return callableWrapper;
};

const createFunction = (name, callable, acceptedArguments, options = {}) => {
    const callableWrapper = createCallableWrapper(name, callable, acceptedArguments, options);
    return callableWrapper;
};
const createSynchronousFunction = (name, callable, acceptedArguments, options = {}) => {
    const callableWrapper = createSynchronousCallableWrapper(name, callable, acceptedArguments, options);
    return callableWrapper;
};

/**
 * Creates a template test.
 *
 * @param {string} name Name of the test
 * @param {TwingCallable<boolean>} callable A callable implementing the test. If null, you need to overwrite the "node_class" option to customize compilation.
 * @param {TwingCallableArgument[]} acceptedArguments
 * @param {TwingCallableWrapperOptions} options Options
 */
const createTest = (name, callable, acceptedArguments, options = {}) => {
    return createCallableWrapper(name, callable, acceptedArguments, options);
};
/**
 * Creates a synchronous template test.
 *
 * @param name Name of the test
 * @param callable A callable implementing the test. If null, you need to overwrite the "node_class" option to customize compilation.
 * @param acceptedArguments
 * @param options Options
 */
const createSynchronousTest = (name, callable, acceptedArguments, options = {}) => {
    return createSynchronousCallableWrapper(name, callable, acceptedArguments, options);
};

const createFilter = (name, callable, acceptedArguments, options = {}) => {
    const callableWrapper = createCallableWrapper(name, callable, acceptedArguments, options);
    const filter = Object.assign({}, callableWrapper);
    return filter;
};
const createSynchronousFilter = (name, callable, acceptedArguments, options = {}) => {
    const callableWrapper = createSynchronousCallableWrapper(name, callable, acceptedArguments, options);
    const filter = Object.assign({}, callableWrapper);
    return filter;
};

const createOperator = (name, type, precedence, expressionFactory, associativity = null, specificationLevel = 2) => {
    associativity = type === "BINARY" ? (associativity || "LEFT") : null;
    return {
        get associativity() {
            return associativity;
        },
        get expressionFactory() {
            return expressionFactory;
        },
        get name() {
            return name;
        },
        get precedence() {
            return precedence;
        },
        get specificationLevel() {
            return specificationLevel;
        },
        get type() {
            return type;
        }
    };
};

const isEven = (_executionContext, value) => {
    return Promise.resolve(value % 2 === 0);
};
const isEvenSynchronously = (_executionContext, value) => {
    return value % 2 === 0;
};

const isOdd = (_executionContext, value) => {
    return Promise.resolve(value % 2 === 1);
};
const isOddSynchronously = (_executionContext, value) => {
    return value % 2 === 1;
};

const isSameAs = (_executionContext, a, comparand) => {
    return Promise.resolve(a === comparand);
};
const isSameAsSynchronously = (_executionContext, a, comparand) => {
    return a === comparand;
};

const isNull = (_executionContext, value) => {
    return Promise.resolve(value === null);
};
const isNullSynchronously = (_executionContext, value) => {
    return value === null;
};

const isDivisibleBy = (_executionContext, a, divisor) => {
    return Promise.resolve(a % divisor === 0);
};
const isDivisibleBySynchronously = (_executionContext, a, divisor) => {
    return a % divisor === 0;
};

const min = (_executionContext, ...values) => {
    if (values.length === 1) {
        values = values[0];
    }
    return Promise.resolve(math.min(iteratorToArray(values)));
};
const minSynchronously = (_executionContext, ...values) => {
    if (values.length === 1) {
        values = values[0];
    }
    return math.min(iteratorToArray(values));
};

const max = (_executionContext, ...values) => {
    if (values.length === 1) {
        values = values[0];
    }
    return Promise.resolve(math.max(iteratorToArray(values)));
};
const maxSynchronously = (_executionContext, ...values) => {
    if (values.length === 1) {
        values = values[0];
    }
    return math.max(iteratorToArray(values));
};

const padStart = function (value, length, padString) {
    let result = '' + value;
    result = pad(length, result, padString);
    return result;
};
/**
 * @param {"luxon".luxon.Duration} duration
 * @param {string} format
 *
 * @returns {string} The formatted interval.
 */
const formatDuration = (duration, format) => {
    let result;
    result = format.replace(/%([YyMmDdaHhIiSsFfRr])/g, function (_match, token) {
        let result;
        let isNegative = false;
        if (duration.as('milliseconds') < 0) {
            isNegative = true;
            duration = duration.negate();
        }
        switch (token) {
            case 'Y': {
                // 	Years, numeric, at least 2 digits with leading 0
                result = padStart(duration.years, 2, '0');
                break;
            }
            case 'y': {
                // Years, numeric
                result = duration.years;
                break;
            }
            case 'M': {
                // Months, numeric, at least 2 digits with leading 0
                result = padStart(duration.months, 2, '0');
                break;
            }
            case 'm': {
                // Months, numeric
                result = duration.months;
                break;
            }
            case 'D': {
                // Days, numeric, at least 2 digits with leading 0
                result = padStart(duration.days, 2, '0');
                break;
            }
            case 'd':
            case 'a': {
                // Days, numeric
                // Total number of days as a result of a DateTime::diff() or (unknown) otherwise
                result = duration.days;
                break;
            }
            case 'H': {
                // Hours, numeric, at least 2 digits with leading 0
                result = padStart(duration.hours, 2, '0');
                break;
            }
            case 'h': {
                // Hours, numeric
                result = duration.hours;
                break;
            }
            case 'I': {
                // Minutes, numeric, at least 2 digits with leading 0
                result = padStart(duration.minutes, 2, '0');
                break;
            }
            case 'i': {
                // 	Minutes, numeric
                result = duration.minutes;
                break;
            }
            case 'S': {
                // 	Seconds, numeric, at least 2 digits with leading 0
                result = padStart(duration.seconds, 2, '0');
                break;
            }
            case 's': {
                // Seconds, numeric
                result = duration.seconds;
                break;
            }
            case 'F': {
                // Microseconds, numeric, at least 6 digits with leading 0
                result = padStart(duration.milliseconds * 1000, 6, '0');
                break;
            }
            case 'f': {
                // Microseconds, numeric
                result = duration.milliseconds * 1000;
                break;
            }
            case 'R': {
                // Sign "-" when negative, "+" when positive
                result = isNegative ? '-' : '+';
                break;
            }
            case 'r': {
                // Sign "-" when negative, empty when positive
                result = isNegative ? '-' : '';
                break;
            }
        }
        return result;
    });
    return result;
};

/**
 * For the formats reference, @see https://secure.php.net/manual/en/function.date.php
 */
const formatters = {
    d: (dateTime) => {
        /**
         * Day of the month, 2 digits with leading zeros
         */
        return dateTime.toFormat('dd');
    },
    D: (dateTime) => {
        /**
         * A textual representation of a day, three letters
         */
        return dateTime.weekdayShort;
    },
    j: (dateTime) => {
        /**
         * Day of the month without leading zeros
         */
        return dateTime.day;
    },
    l: (dateTime) => {
        /**
         * A full textual representation of the day of the week
         */
        return dateTime.weekdayLong;
    },
    N: (dateTime) => {
        /**
         * ISO-8601 numeric representation of the day of the week (starting from 1)
         */
        return dateTime.weekday;
    },
    S: (dateTime) => {
        /**
         * English ordinal suffix for the day of the month, 2 characters
         */
        const day = dateTime.day;
        if ((day >= 10) && (day <= 20)) {
            return 'th';
        }
        switch (day % 10) {
            case 1:
                return 'st';
            case 2:
                return 'nd';
            case 3:
                return 'rd';
            default:
                return 'th';
        }
    },
    w: (dateTime) => {
        /**
         * Numeric representation of the day of the week (starting from 0)
         */
        return dateTime.weekday - 1;
    },
    z: (dateTime) => {
        /**
         * The day of the year (starting from 0)
         */
        return dateTime.ordinal - 1;
    },
    L: (dateTime) => {
        /**
         * Whether it's a leap year
         */
        return dateTime.isInLeapYear ? 1 : 0;
    },
    o: (dateTime) => {
        /**
         * ISO-8601 week-numbering year. This has the same value as Y, except that if the ISO week number (W) belongs to the previous or next year, that year is used instead.
         */
        return formatters.Y(dateTime);
    },
    W: (dateTime) => {
        /**
         * ISO-8601 week number of year, weeks starting on Monday
         */
        return dateTime.toFormat('WW');
    },
    F: (dateTime) => {
        /**
         * A full textual representation of a month, such as January or March
         */
        return dateTime.toFormat('LLLL');
    },
    m: (dateTime) => {
        /**
         * Numeric representation of a month, with leading zeros
         */
        return dateTime.toFormat('LL');
    },
    M: (dateTime) => {
        /**
         * A short textual representation of a month, three letters
         */
        return dateTime.toFormat('LLL');
    },
    n: (dateTime) => {
        /**
         * Numeric representation of a month, without leading zero
         */
        return dateTime.toFormat('L');
    },
    t: (dateTime) => {
        /**
         * Number of days in the given month
         */
        return dateTime.daysInMonth;
    },
    Y: (dateTime) => {
        /**
         * A full numeric representation of a year, 4 digits
         */
        return dateTime.toFormat('yyyy');
    },
    y: (dateTime) => {
        /**
         * A two digit representation of a year
         */
        return dateTime.toFormat('yy');
    },
    a: (dateTime) => {
        /**
         * Lowercase Ante meridiem and Post meridiem
         */
        return formatters.A(dateTime).toLowerCase();
    },
    A: (dateTime) => {
        /**
         * Uppercase Ante meridiem and Post meridiem
         */
        return dateTime.toFormat('a');
    },
    B: (dateTime) => {
        /**
         * Swatch Internet time
         */
        return Math.floor((dateTime.second + (dateTime.minute * 60) + (dateTime.hour * 3600)) / 86.4);
    },
    g: (dateTime) => {
        /**
         * 12-hour format of an hour without leading zeros
         */
        return dateTime.toFormat('h');
    },
    G: (dateTime) => {
        /**
         * 24-hour format of an hour without leading zeros
         */
        return dateTime.toFormat('H');
    },
    h: (dateTime) => {
        /**
         * 12-hour format of an hour with leading zeros
         */
        return dateTime.toFormat('hh');
    },
    H: (dateTime) => {
        /**
         * 24-hour format of an hour with leading zeros
         */
        return dateTime.toFormat('HH');
    },
    i: (dateTime) => {
        /**
         * Minutes with leading zeros
         */
        return dateTime.toFormat('mm');
    },
    s: (dateTime) => {
        /**
         * Seconds, with leading zeros
         */
        return dateTime.toFormat('ss');
    },
    u: (dateTime) => {
        /**
         * Microseconds
         */
        return dateTime.millisecond * 1000;
    },
    v: (dateTime) => {
        /**
         * Milliseconds
         */
        return dateTime.millisecond;
    },
    e: (dateTime) => {
        /**
         * Timezone identifier
         */
        return dateTime.toFormat('z');
    },
    I: (dateTime) => {
        /**
         * Whether or not the date is in daylight saving time
         */
        return dateTime.isInDST ? 1 : 0;
    },
    O: (dateTime) => {
        /**
         * Difference to Greenwich time (GMT) in hours
         */
        return dateTime.toFormat('ZZZ');
    },
    P: (dateTime) => {
        /**
         * Difference to Greenwich time (GMT) with colon between hours and minutes
         */
        return dateTime.toFormat('ZZ');
    },
    T: (dateTime) => {
        /**
         * Timezone abbreviation
         */
        return dateTime.toFormat('ZZZZ');
    },
    Z: (dateTime) => {
        /**
         * Timezone offset in seconds. The offset for timezones west of UTC is always negative, and for those east of UTC is always positive.
         */
        return dateTime.offset * 60;
    },
    c: (dateTime) => {
        /**
         * ISO 8601 date
         */
        return formatDateTime(dateTime, 'Y-m-d') + 'T' + formatDateTime(dateTime, 'H:i:s') + formatters.P(dateTime);
    },
    r: (dateTime) => {
        /**
         * RFC 2822 formatted date
         */
        return formatDateTime(dateTime, 'D, d M Y H:i:s ') + formatters.O(dateTime);
    },
    U: (dateTime) => {
        /**
         * Seconds since the Unix Epoch (January 1 1970 00:00:00 GMT)
         */
        return Math.floor(dateTime.toMillis() / 1000);
    }
};
const regExp = new RegExp(`[${Object.keys(formatters).join("")}]`, 'g');
function formatDateTime(date, format) {
    return format.replace(regExp, (m) => {
        return formatters[m](date);
    });
}

function modifyDate(modifier) {
    let result = null;
    const regExp = /^([-|\+])([0-9]+?)(\s*)([a-z]*)/g;
    const matches = regExp.exec(modifier);
    if (matches) {
        result = luxon.DateTime.local();
        let sign = matches[1];
        let count = parseInt(matches[2]);
        let unit = matches[4];
        switch (unit) {
            case 'year':
                unit = 'years';
                break;
            case 'month':
                unit = 'months';
                break;
            case 'day':
                unit = 'days';
                break;
            case 'hour':
                unit = 'hours';
                break;
            case 'minute':
                unit = 'minutes';
                break;
            case 'second':
                unit = 'seconds';
                break;
        }
        let duration = {};
        duration[unit] = (sign === '-' ? -count : count);
        result = result.plus(duration);
    }
    else {
        result = luxon.DateTime.invalid(`Failed to parse relative date "${modifier}".`);
    }
    return result;
}

/**
 * Converts an input to a DateTime instance.
 *
 * <pre>
 *    {% if date(user.created_at) < date('+2days') %}
 *      {# do something #}
 *    {% endif %}
 * </pre>
 *
 * @param {TwingTemplate} template
 * @param {Date | DateTime | Duration | number | string} input A date or null to use the current time
 * @param {string | null | boolean} timezone The target timezone, null to use the default, false to leave unchanged
 *
 * @returns {Promise<DateTime | Duration>}
 */
const createDateTime = (defaultTimezone, input, timezone) => {
    const _do = () => {
        let result;
        if (input === null) {
            result = luxon.DateTime.local();
        }
        else if (typeof input === 'number') {
            result = luxon.DateTime.fromMillis(input * 1000);
        }
        else if (typeof input === 'string') {
            if (input === 'now') {
                result = luxon.DateTime.local();
            }
            else {
                result = luxon.DateTime.fromISO(input, {
                    setZone: true
                });
                if (!result.isValid) {
                    result = luxon.DateTime.fromRFC2822(input, {
                        setZone: true
                    });
                }
                if (!result.isValid) {
                    result = luxon.DateTime.fromSQL(input, {
                        setZone: true
                    });
                }
                if (!result.isValid && /^-{0,1}\d+$/.test(input)) {
                    result = luxon.DateTime.fromMillis(Number.parseInt(input) * 1000, {
                        setZone: true
                    });
                }
                if (!result.isValid) {
                    result = modifyDate(input);
                }
            }
        }
        else if (input instanceof luxon.DateTime) {
            result = input;
        }
        else {
            result = luxon.DateTime.fromJSDate(input);
        }
        if (!result || !result.isValid) {
            throw new Error(`Failed to parse date "${input}".`);
        }
        // now let's apply timezone
        // determine the timezone
        if (timezone !== false) {
            if (timezone === null) {
                timezone = defaultTimezone;
            }
            result = result.setZone(timezone);
        }
        return result;
    };
    try {
        return Promise.resolve(_do());
    }
    catch (e) {
        return Promise.reject(e);
    }
};
const date$1 = (executionContext, date, timezone) => {
    if (date instanceof luxon.Duration) {
        return Promise.resolve(date);
    }
    return createDateTime(executionContext.environment.timezone, date, timezone);
};
const createDateTimeSynchronously = (defaultTimezone, input, timezone) => {
    let result;
    if (input === null) {
        result = luxon.DateTime.local();
    }
    else if (typeof input === 'number') {
        result = luxon.DateTime.fromMillis(input * 1000);
    }
    else if (typeof input === 'string') {
        if (input === 'now') {
            result = luxon.DateTime.local();
        }
        else {
            result = luxon.DateTime.fromISO(input, {
                setZone: true
            });
            if (!result.isValid) {
                result = luxon.DateTime.fromRFC2822(input, {
                    setZone: true
                });
            }
            if (!result.isValid) {
                result = luxon.DateTime.fromSQL(input, {
                    setZone: true
                });
            }
            if (!result.isValid && /^-{0,1}\d+$/.test(input)) {
                result = luxon.DateTime.fromMillis(Number.parseInt(input) * 1000, {
                    setZone: true
                });
            }
            if (!result.isValid) {
                result = modifyDate(input);
            }
        }
    }
    else if (input instanceof luxon.DateTime) {
        result = input;
    }
    else {
        result = luxon.DateTime.fromJSDate(input);
    }
    if (!result || !result.isValid) {
        throw new Error(`Failed to parse date "${input}".`);
    }
    // now let's apply timezone
    // determine the timezone
    if (timezone !== false) {
        if (timezone === null) {
            timezone = defaultTimezone;
        }
        result = result.setZone(timezone);
    }
    return result;
};
const dateSynchronously = (executionContext, date, timezone) => {
    if (date instanceof luxon.Duration) {
        return date;
    }
    return createDateTimeSynchronously(executionContext.environment.timezone, date, timezone);
};

/**
 * Converts a date to the given format.
 *
 * <pre>
 *   {{ post.published_at|date("m/d/Y") }}
 * </pre>
 *
 * @param executionContext
 * @param date A date
 * @param format The target format, null to use the default
 * @param timezone The target timezone, null to use the default, false to leave unchanged
 *
 * @return {Promise<string>} The formatted date
 */
const date = (executionContext, date, format, timezone) => {
    const { environment } = executionContext;
    const { dateFormat, dateIntervalFormat } = environment;
    return date$1(executionContext, date, timezone)
        .then((date) => {
        if (date instanceof luxon.Duration) {
            if (format === null) {
                format = dateIntervalFormat;
            }
            return Promise.resolve(formatDuration(date, format));
        }
        if (format === null) {
            format = dateFormat;
        }
        return Promise.resolve(formatDateTime(date, format));
    });
};
const dateFilterSynchronously = (executionContext, date, format, timezone) => {
    const { environment } = executionContext;
    const { dateFormat, dateIntervalFormat } = environment;
    const durationOrDateTime = dateSynchronously(executionContext, date, timezone);
    if (durationOrDateTime instanceof luxon.Duration) {
        if (format === null) {
            format = dateIntervalFormat;
        }
        return formatDuration(durationOrDateTime, format);
    }
    if (format === null) {
        format = dateFormat;
    }
    return formatDateTime(durationOrDateTime, format);
};

/**
 * Returns a new date object modified.
 *
 * <pre>
 *   {{ post.published_at|date_modify("-1day")|date("m/d/Y") }}
 * </pre>
 *
 * @param {TwingTemplate} template
 * @param {DateTime|string} date A date
 * @param {string} modifier A modifier string
 *
 * @returns {Promise<DateTime>} A new date object
 */
const dateModify = (executionContext, date, modifier) => {
    const { environment } = executionContext;
    const { timezone: defaultTimezone } = environment;
    return createDateTime(defaultTimezone, date, null)
        .then((dateTime) => {
        let regExp = new RegExp(/(\+|-)([0-9])(.*)/);
        let parts = regExp.exec(modifier);
        let operator = parts[1];
        let operand = Number.parseInt(parts[2]);
        let unit = parts[3].trim();
        let duration = {};
        duration[unit] = operator === '-' ? -operand : operand;
        dateTime = dateTime.plus(duration);
        return dateTime;
    });
};
const dateModifySynchronously = (executionContext, date, modifier) => {
    const { environment } = executionContext;
    const { timezone: defaultTimezone } = environment;
    let dateTime = createDateTimeSynchronously(defaultTimezone, date, null);
    let regExp = new RegExp(/(\+|-)([0-9])(.*)/);
    let parts = regExp.exec(modifier);
    let operator = parts[1];
    let operand = Number.parseInt(parts[2]);
    let unit = parts[3].trim();
    let duration = {};
    duration[unit] = operator === '-' ? -operand : operand;
    dateTime = dateTime.plus(duration);
    return dateTime;
};

const format = (_executionContext, ...args) => {
    return Promise.resolve(phpSprintf(...args.map((arg) => {
        return arg.toString();
    })));
};
const formatSynchronously = (_executionContext, ...args) => {
    return phpSprintf(...args.map((arg) => {
        return arg.toString();
    }));
};

/**
 * Replaces strings within a string.
 *
 * @param {string} value String to replace in
 * @param {Array<string>|Map<string, string>} from Replace values
 *
 * @returns {Promise<string>}
 */
const replace = (_executionContext, value, from) => {
    const _do = () => {
        if (isTraversable(from)) {
            from = iteratorToHash(from);
        }
        else if (typeof from !== 'object') {
            throw new Error(`The "replace" filter expects an hash or "Iterable" as replace values, got "${typeof from}".`);
        }
        if (value === null) {
            value = '';
        }
        return phpStrtr(value, from);
    };
    try {
        return Promise.resolve(_do());
    }
    catch (error) {
        return Promise.reject(error);
    }
};
const replaceSynchronously = (_executionContext, value, from) => {
    if (isTraversable(from)) {
        from = iteratorToHash(from);
    }
    else if (typeof from !== 'object') {
        throw new Error(`The "replace" filter expects an hash or "Iterable" as replace values, got "${typeof from}".`);
    }
    if (value === null) {
        value = '';
    }
    return phpStrtr(value, from);
};

/**
 * Number format filter.
 *
 * All of the formatting options can be left null, in that case the defaults will
 * be used.  Supplying any of the parameters will override the defaults set in the
 * environment object.
 *
 * @param {*} number A float/int/string of the number to format
 * @param {number} numberOfDecimals the number of decimal points to display
 * @param {string} decimalPoint the character(s) to use for the decimal point
 * @param {string} thousandSeparator the character(s) to use for the thousands separator
 *
 * @returns {Promise<string>} The formatted number
 */
const numberFormat = (executionContext, number, numberOfDecimals, decimalPoint, thousandSeparator) => {
    const { environment } = executionContext;
    const { numberFormat } = environment;
    if (numberOfDecimals === null) {
        numberOfDecimals = numberFormat.numberOfDecimals;
    }
    if (decimalPoint === null) {
        decimalPoint = numberFormat.decimalPoint;
    }
    if (thousandSeparator === null) {
        thousandSeparator = numberFormat.thousandSeparator;
    }
    return Promise.resolve(phpNumberFormat(number, numberOfDecimals, decimalPoint, thousandSeparator));
};
const numberFormatSynchronously = (executionContext, number, numberOfDecimals, decimalPoint, thousandSeparator) => {
    const { environment } = executionContext;
    const { numberFormat } = environment;
    if (numberOfDecimals === null) {
        numberOfDecimals = numberFormat.numberOfDecimals;
    }
    if (decimalPoint === null) {
        decimalPoint = numberFormat.decimalPoint;
    }
    if (thousandSeparator === null) {
        thousandSeparator = numberFormat.thousandSeparator;
    }
    return phpNumberFormat(number, numberOfDecimals, decimalPoint, thousandSeparator);
};

/**
 * Return the absolute value of a number.
 *
 * @param _executionContext
 * @param x
 */
const abs = (_executionContext, x) => {
    return Promise.resolve(Math.abs(x));
};
const absSynchronously = (_executionContext, x) => {
    return Math.abs(x);
};

/**
 * URL encodes (RFC 3986) a string as a path segment or a hash as a query string.
 *
 * @param {string|{}} url A URL or a hash of query parameters
 *
 * @returns {Promise<string>} The URL encoded value
 */
const url_encode = (_executionContext, url) => {
    if (typeof url !== 'string') {
        if (isTraversable(url)) {
            url = iteratorToHash(url);
        }
        const builtUrl = phpHttpBuildQuery(url, '', '&');
        return Promise.resolve(builtUrl.replace(/\+/g, '%20'));
    }
    return Promise.resolve(encodeURIComponent(url));
};
const urlEncodeSynchronously = (_executionContext, url) => {
    if (typeof url !== 'string') {
        if (isTraversable(url)) {
            url = iteratorToHash(url);
        }
        const builtUrl = phpHttpBuildQuery(url, '', '&');
        return builtUrl.replace(/\+/g, '%20');
    }
    return encodeURIComponent(url);
};

function isPureArray(map) {
    let result = true;
    let keys = Array.from(map.keys());
    let i = 0;
    while (result && (i < keys.length)) {
        let key = keys[i];
        result = (Number(key) === i);
        i++;
    }
    return result;
}
const jsonEncode = (_executionContext, value) => {
    const _sanitize = (value) => {
        if (isTraversable(value) || isPlainObject(value)) {
            value = iteratorToMap(value);
        }
        if (value instanceof Map) {
            let sanitizedValue;
            if (isPureArray(value)) {
                value = iteratorToArray(value);
                sanitizedValue = [];
                for (const key in value) {
                    sanitizedValue.push(_sanitize(value[key]));
                }
            }
            else {
                value = iteratorToHash(value);
                sanitizedValue = {};
                for (let key in value) {
                    sanitizedValue[key] = _sanitize(value[key]);
                }
            }
            value = sanitizedValue;
        }
        return value;
    };
    return Promise.resolve(JSON.stringify(_sanitize(value)));
};
const jsonEncodeSynchronously = (_executionContext, value) => {
    const _sanitize = (value) => {
        if (isTraversable(value) || isPlainObject(value)) {
            value = iteratorToMap(value);
        }
        if (value instanceof Map) {
            let sanitizedValue;
            if (isPureArray(value)) {
                value = iteratorToArray(value);
                sanitizedValue = [];
                for (const key in value) {
                    sanitizedValue.push(_sanitize(value[key]));
                }
            }
            else {
                value = iteratorToHash(value);
                sanitizedValue = {};
                for (let key in value) {
                    sanitizedValue[key] = _sanitize(value[key]);
                }
            }
            value = sanitizedValue;
        }
        return value;
    };
    return JSON.stringify(_sanitize(value));
};

/**
 * Internationalization conversion: convert buffer to requested character encoding
 *
 * @param {string} inCharset The input charset.
 * @param {string} outCharset The output charset.
 * @param {Buffer} buffer The buffer to be converted.
 *
 * @returns {Buffer} the converted buffer or false on failure.
 */
function iconv(inCharset, outCharset, buffer) {
    let str = IconVLite.decode(buffer, inCharset);
    buffer = IconVLite.encode(str, outCharset);
    return buffer;
}

const convertEncoding = (_executionContext, value, to, from) => {
    return Promise.resolve(iconv(from, to, Buffer.from(value)));
};
const convertEncodingSynchronously = (_executionContext, value, to, from) => {
    return iconv(from, to, Buffer.from(value));
};

/**
 * Returns a title-cased string.
 *
 * @param _executionContext
 * @param string A string
 *
 * @returns The title-cased string
 */
const title = (_executionContext, string) => {
    const result = phpUcwords(string.toString().toLowerCase());
    return Promise.resolve(result);
};
const titleSynchronously = (_executionContext, string) => {
    const result = phpUcwords(string.toString().toLowerCase());
    return result;
};

/**
 * Returns a capitalized string.
 *
 * @param {string | TwingMarkup} string A string
 *
 * @returns {Promise<string>} The capitalized string
 */
const capitalize = (_executionContext, string) => {
    if ((string === null) || (string === undefined) || string === '') {
        return Promise.resolve(string);
    }
    return Promise.resolve(words(string.toString()));
};
const capitalizeSynchronously = (_executionContext, string) => {
    if ((string === null) || (string === undefined) || string === '') {
        return string;
    }
    return words(string.toString());
};

/**
 * Converts a string to uppercase.
 *
 * @param {string | TwingMarkup} string A string
 *
 * @returns {Promise<string>} The uppercased string
 */
const upper = (_executionContext, string) => {
    return Promise.resolve(string.toString().toUpperCase());
};
const upperSynchronously = (_executionContext, string) => {
    return string.toString().toUpperCase();
};

/**
 * Converts a string to lowercase.
 *
 * @param {string | TwingMarkup} string A string
 *
 * @returns The lowercased string
 */
const lower = (_executionContext, string) => {
    return Promise.resolve(string.toString().toLowerCase());
};
const lowerSynchronously = (_executionContext, string) => {
    return string.toString().toLowerCase();
};

const striptags = (_executionContext, input, allowedTags) => {
    return Promise.resolve(phpStripTags(input, allowedTags));
};
const striptagsSynchronously = (_executionContext, input, allowedTags) => {
    return phpStripTags(input, allowedTags);
};

/**
 * Returns a trimmed string.
 *
 * @returns {Promise<string>}
 *
 * @throws TwingErrorRuntime When an invalid trimming side is used (not a string or not 'left', 'right', or 'both')
 */
const trim = (_executionContext, string, characterMask, side) => {
    const _do = () => {
        if (string === null) {
            return null;
        }
        if (characterMask === null) {
            characterMask = " \t\n\r\0\x0B";
        }
        switch (side) {
            case 'both':
                return phpTrim(string, characterMask);
            case 'left':
                return phpLeftTrim(string, characterMask);
            case 'right':
                return rtrim(string, characterMask);
            default:
                throw new Error('Trimming side must be "left", "right" or "both".');
        }
    };
    try {
        return Promise.resolve(_do());
    }
    catch (error) {
        return Promise.reject(error);
    }
};
const trimSynchronously = (_executionContext, string, characterMask, side) => {
    if (string === null) {
        return null;
    }
    if (characterMask === null) {
        characterMask = " \t\n\r\0\x0B";
    }
    switch (side) {
        case 'both':
            return phpTrim(string, characterMask);
        case 'left':
            return phpLeftTrim(string, characterMask);
        case 'right':
            return rtrim(string, characterMask);
        default:
            throw new Error('Trimming side must be "left", "right" or "both".');
    }
};

const nl2br = (_executionContext, ...args) => {
    return Promise.resolve(createMarkup(phpNl2br(...args)));
};
const nl2brSynchronously = (_executionContext, ...args) => {
    return createMarkup(phpNl2br(...args));
};

/**
 * Marks a variable as being safe.
 *
 * @param {string | TwingMarkup} value A variable
 *
 * @return {Promise<string>}
 */
const raw = (_executionContext, value) => {
    return Promise.resolve(createMarkup(value !== null ? value.toString() : ''));
};
const rawSynchronously = (_executionContext, value) => {
    return createMarkup(value !== null ? value.toString() : '');
};

/**
 * Joins the values to a string.
 *
 * The separator between elements is an empty string per default, you can define it with the optional parameter.
 *
 * <pre>
 *  {{ [1, 2, 3]|join('|') }}
 *  {# returns 1|2|3 #}
 *
 *  {{ [1, 2, 3]|join }}
 *  {# returns 123 #}
 * </pre>
 *
 * @param _executionContext
 * @param value A value
 * @param glue The separator
 * @param and The separator for the last pair
 *
 * @returns {Promise<string>} The concatenated string
 */
const join = (_executionContext, value, glue, and) => {
    const _do = () => {
        if ((value == null) || (value === undefined)) {
            return '';
        }
        if (isTraversable(value)) {
            value = iteratorToArray(value);
            // this is ugly, but we have to ensure that each element of the array is rendered as PHP would render it
            const safeValue = value.map((item) => {
                if (typeof item === 'boolean') {
                    return (item === true) ? '1' : '';
                }
                if (Array.isArray(item)) {
                    return 'Array';
                }
                return item;
            });
            if (and === null || and === glue) {
                return safeValue.join(glue);
            }
            if (safeValue.length === 1) {
                return safeValue[0];
            }
            return safeValue.slice(0, -1).join(glue) + and + safeValue[safeValue.length - 1];
        }
        return '';
    };
    return Promise.resolve(_do());
};
const joinSynchronously = (_executionContext, value, glue, and) => {
    if ((value == null) || (value === undefined)) {
        return '';
    }
    if (isTraversable(value)) {
        value = iteratorToArray(value);
        // this is ugly, but we have to ensure that each element of the array is rendered as PHP would render it
        const safeValue = value.map((item) => {
            if (typeof item === 'boolean') {
                return (item === true) ? '1' : '';
            }
            if (Array.isArray(item)) {
                return 'Array';
            }
            return item;
        });
        if (and === null || and === glue) {
            return safeValue.join(glue);
        }
        if (safeValue.length === 1) {
            return safeValue[0];
        }
        return safeValue.slice(0, -1).join(glue) + and + safeValue[safeValue.length - 1];
    }
    return '';
};

/**
 * Splits the string into an array.
 *
 * <pre>
 *  {{ "one,two,three"|split(',') }}
 *  {# returns [one, two, three] #}
 *
 *  {{ "one,two,three,four,five"|split(',', 3) }}
 *  {# returns [one, two, "three,four,five"] #}
 *
 *  {{ "123"|split('') }}
 *  {# returns [1, 2, 3] #}
 *
 *  {{ "aabbcc"|split('', 2) }}
 *  {# returns [aa, bb, cc] #}
 * </pre>
 *
 * @param {string} value A string
 * @param {string} delimiter The delimiter
 * @param {number} limit The limit
 *
 * @returns {Promise<Array<string>>} The split string as an array
 */
const split = (_executionContext, value, delimiter, limit) => {
    let _do = () => {
        if (delimiter) {
            return !limit ? explode(delimiter, value) : explode(delimiter, value, limit);
        }
        if (!limit || limit <= 1) {
            return value.match(/.{1,1}/ug);
        }
        let length = value.length;
        if (length < limit) {
            return [value];
        }
        let r = [];
        for (let i = 0; i < length; i += limit) {
            r.push(value.substr(i, limit));
        }
        return r;
    };
    return Promise.resolve(_do());
};
const splitSynchronously = (_executionContext, value, delimiter, limit) => {
    if (delimiter) {
        return !limit ? explode(delimiter, value) : explode(delimiter, value, limit);
    }
    if (!limit || limit <= 1) {
        return value.match(/.{1,1}/ug);
    }
    let length = value.length;
    if (length < limit) {
        return [value];
    }
    let r = [];
    for (let i = 0; i < length; i += limit) {
        r.push(value.substr(i, limit));
    }
    return r;
};

const sortAsynchronously = (array, comparator) => {
    /**
     * return the median value among x, y, and z
     */
    const getPivot = async (x, y, z, comparator) => {
        if (await comparator(x, y) < 0) {
            if (await comparator(y, z) < 0) {
                return y;
            }
            else if (await comparator(z, x) < 0) {
                return x;
            }
            else {
                return z;
            }
        }
        else if (await comparator(y, z) > 0) {
            return y;
        }
        else if (await comparator(z, x) > 0) {
            return x;
        }
        else {
            return z;
        }
    };
    /**
     * Asynchronous quick sort.
     *
     * @see https://gist.github.com/kimamula/fa34190db624239111bbe0deba72a6ab
     *
     * @param array The array to sort
     * @param comparator The comparator function
     * @param left The index where the range of elements to be sorted starts
     * @param right The index where the range of elements to be sorted ends
     */
    const quickSort = async (array, comparator, left = 0, right = array.length - 1) => {
        if (left < right) {
            let i = left;
            let j = right;
            let tmp;
            const pivot = await getPivot(array[i], array[i + Math.floor((j - i) / 2)], array[j], comparator);
            while (true) {
                while (await comparator(array[i], pivot) < 0) {
                    i++;
                }
                while (await comparator(pivot, array[j]) < 0) {
                    j--;
                }
                if (i >= j) {
                    break;
                }
                tmp = array[i];
                array[i] = array[j];
                array[j] = tmp;
                i++;
                j--;
            }
            await quickSort(array, comparator, left, i - 1);
            await quickSort(array, comparator, j + 1, right);
        }
        return array;
    };
    return quickSort(array, comparator);
};

/**
 * Sort a map and maintain index association.
 *
 * @param map
 * @param compareFunction
 * @returns
 */
const asort = async (map, compareFunction) => {
    const sortedMap = new Map();
    const keys = [].fill(null, 0, map.size);
    const values = [...map.values()];
    let sortedValues;
    if (compareFunction) {
        sortedValues = await sortAsynchronously(values, compareFunction);
    }
    else {
        sortedValues = values.sort();
    }
    for (const [key, value] of map) {
        const index = sortedValues.indexOf(value);
        keys[index] = key;
    }
    for (const key of keys) {
        sortedMap.set(key, map.get(key));
    }
    map.clear();
    for (const [key, value] of sortedMap) {
        map.set(key, value);
    }
};
const asortSynchronously = (map, compareFunction) => {
    const sortedMap = new Map();
    const keys = [].fill(null, 0, map.size);
    const values = [...map.values()];
    let sortedValues;
    if (compareFunction) {
        sortedValues = values.sort(compareFunction);
    }
    else {
        sortedValues = values.sort();
    }
    for (const [key, value] of map) {
        const index = sortedValues.indexOf(value);
        keys[index] = key;
    }
    for (const key of keys) {
        sortedMap.set(key, map.get(key));
    }
    map.clear();
    for (const [key, value] of sortedMap) {
        map.set(key, value);
    }
};

/**
 * Sorts an iterable.
 *
 * @param _executionContext
 * @param iterable
 * @param arrow
 *
 * @returns {Promise<Map<any, any>>}
 */
const sort = async (_executionContext, iterable, arrow) => {
    if (!isTraversable(iterable)) {
        return Promise.reject(new Error(`The sort filter only works with iterables, got "${typeof iterable}".`));
    }
    const map = iteratorToMap(iterable);
    await asort(map, arrow || undefined);
    return map;
};
const sortSynchronously = (_executionContext, iterable, arrow) => {
    if (!isTraversable(iterable)) {
        throw new Error(`The sort filter only works with iterables, got "${typeof iterable}".`);
    }
    const map = iteratorToMap(iterable);
    asortSynchronously(map, arrow || undefined);
    return map;
};

/**
 * Merges an array with another one.
 *
 * <pre>
 *  {% set items = { 'apple': 'fruit', 'orange': 'fruit' } %}
 *
 *  {% set items = items|merge({ 'peugeot': 'car' }) %}
 *
 *  {# items now contains { 'apple': 'fruit', 'orange': 'fruit', 'peugeot': 'car' } #}
 * </pre>
 *
 * @param {any} iterable1 An iterable
 * @param {any} source An iterable
 *
 * @return {Promise<Map<any, any>>} The merged map
 */
const merge = (_executionContext, iterable1, source) => {
    const isIterable1NullOrUndefined = (iterable1 === null) || (iterable1 === undefined);
    if (isIterable1NullOrUndefined || (!isTraversable(iterable1) && (typeof iterable1 !== 'object'))) {
        return Promise.reject(new Error(`The merge filter only works on arrays or "Traversable", got "${!isIterable1NullOrUndefined ? typeof iterable1 : iterable1}".`));
    }
    const isSourceNullOrUndefined = (source === null) || (source === undefined);
    if (isSourceNullOrUndefined || (!isTraversable(source) && (typeof source !== 'object'))) {
        return Promise.reject(new Error(`The merge filter only accepts arrays or "Traversable" as source, got "${!isSourceNullOrUndefined ? typeof source : source}".`));
    }
    return Promise.resolve(mergeIterables(iteratorToMap(iterable1), iteratorToMap(source)));
};
const mergeSynchronously = (_executionContext, iterable1, source) => {
    const isIterable1NullOrUndefined = (iterable1 === null) || (iterable1 === undefined);
    if (isIterable1NullOrUndefined || (!isTraversable(iterable1) && (typeof iterable1 !== 'object'))) {
        throw new Error(`The merge filter only works on arrays or "Traversable", got "${!isIterable1NullOrUndefined ? typeof iterable1 : iterable1}".`);
    }
    const isSourceNullOrUndefined = (source === null) || (source === undefined);
    if (isSourceNullOrUndefined || (!isTraversable(source) && (typeof source !== 'object'))) {
        throw new Error(`The merge filter only accepts arrays or "Traversable" as source, got "${!isSourceNullOrUndefined ? typeof source : source}".`);
    }
    return mergeIterables(iteratorToMap(iterable1), iteratorToMap(source));
};

/**
 * Split an hash into chunks.
 *
 * @param {*} hash
 * @param {number} size
 * @param {boolean} preserveKeys
 * @returns {Promise<Array<Map<any, any>>>}
 */
async function chunk(hash, size, preserveKeys) {
    let result = [];
    let count = 0;
    let currentMap;
    await iterate(hash, (key, value) => {
        if (!currentMap) {
            currentMap = new Map();
            result.push(currentMap);
        }
        currentMap.set(preserveKeys ? key : count, value);
        count++;
        if (count >= size) {
            count = 0;
            currentMap = null;
        }
        return Promise.resolve();
    });
    return result;
}
/**
 * Split an hash into chunks, synchronously.
 *
 * @param {*} hash
 * @param {number} size
 * @param {boolean} preserveKeys
 */
function chunkSynchronously(hash, size, preserveKeys) {
    let result = [];
    let count = 0;
    let currentMap;
    iterateSynchronously(hash, (key, value) => {
        if (!currentMap) {
            currentMap = new Map();
            result.push(currentMap);
        }
        currentMap.set(preserveKeys ? key : count, value);
        count++;
        if (count >= size) {
            count = 0;
            currentMap = null;
        }
    });
    return result;
}

/**
 * Fill map with value until map's size is size.
 *
 * @param {Map<*, *>} map
 * @param {number} size
 * @param {any} value
 */
function fillMap(map, size, value) {
    if (size > map.size) {
        let delta = size - map.size;
        // resolve the greatest numeric key
        let greatestNumericKey = NaN;
        for (let key of map.keys()) {
            let keyAsNumber = Number(key);
            if (Number.isInteger(keyAsNumber)) {
                if (Number.isNaN(greatestNumericKey) || keyAsNumber > greatestNumericKey) {
                    greatestNumericKey = keyAsNumber;
                }
            }
        }
        let start = Number.isNaN(greatestNumericKey) ? 0 : greatestNumericKey + 1;
        for (let i = start; i < start + delta; i++) {
            map.set(i, value);
        }
    }
}

/**
 * Batches item.
 *
 * @param _executionContext
 * @param {any[]} items An array of items
 * @param {number} size  The size of the batch
 * @param {any} fill A value used to fill missing items
 * @param {boolean} preserveKeys
 *
 * @returns Promise<Map<any, any>[]>
 */
const batch = (_executionContext, items, size, fill, preserveKeys) => {
    if ((items === null) || (items === undefined)) {
        return Promise.resolve([]);
    }
    return chunk(items, size, preserveKeys)
        .then((chunks) => {
        if (fill !== null && chunks.length) {
            const last = chunks.length - 1;
            const lastChunk = chunks[last];
            fillMap(lastChunk, size, fill);
        }
        return chunks;
    });
};
const batchSynchronously = (_executionContext, items, size, fill, preserveKeys) => {
    if ((items === null) || (items === undefined)) {
        return [];
    }
    const chunks = chunkSynchronously(items, size, preserveKeys);
    if (fill !== null && chunks.length) {
        const last = chunks.length - 1;
        const lastChunk = chunks[last];
        fillMap(lastChunk, size, fill);
    }
    return chunks;
};

/**
 * Reverse a map
 *
 * @param {Map<* ,*>} map
 * @param {boolean} preserveKeys
 *
 * @returns Map
 */
function reverse$1(map, preserveKeys) {
    let result = new Map();
    let keys = [...map.keys()];
    let index = 0;
    for (let i = (keys.length - 1); i >= 0; i--) {
        let key = keys[i];
        result.set(preserveKeys ? key : index, map.get(key));
        index++;
    }
    return result;
}

/**
 * Reverses a variable.
 *
 * @param {string | Map<*, *>} item A traversable instance, or a string
 * @param {boolean} preserveKeys Whether to preserve key or not
 *
 * @returns {Promise<string | Map<any, any>>} The reversed input
 */
const reverse = (_executionContext, item, preserveKeys) => {
    if (typeof item === 'string') {
        return Promise.resolve(esrever.reverse(item));
    }
    else {
        return Promise.resolve(reverse$1(iteratorToMap(item), preserveKeys));
    }
};
const reverseSynchronously = (_executionContext, item, preserveKeys) => {
    if (typeof item === 'string') {
        return esrever.reverse(item);
    }
    else {
        return reverse$1(iteratorToMap(item), preserveKeys);
    }
};

/**
 * Returns the length of a thing.
 *
 * @param {any} thing A thing
 *
 * @returns {Promise<number>} The length of the thing
 */
const length = (_executionContext, thing) => {
    let length;
    if ((thing === null) || (thing === undefined)) {
        length = 0;
    }
    else if (thing.length !== undefined) {
        length = thing.length;
    }
    else if (thing.size !== undefined) {
        length = thing.size;
    }
    else if (thing.toString && (typeof thing.toString === 'function')) {
        length = thing.toString().length;
    }
    else {
        length = 1;
    }
    return Promise.resolve(length);
};
const lengthSynchronously = (_executionContext, thing) => {
    let length;
    if ((thing === null) || (thing === undefined)) {
        length = 0;
    }
    else if (thing.length !== undefined) {
        length = thing.length;
    }
    else if (thing.size !== undefined) {
        length = thing.size;
    }
    else if (thing.toString && (typeof thing.toString === 'function')) {
        length = thing.toString().length;
    }
    else {
        length = 1;
    }
    return length;
};

function sliceMap(map, start, length, preserveKeys) {
    let result = new Map();
    let index = 0;
    let keyIndex = 0;
    if (start < 0) {
        start = map.size + start;
    }
    let end;
    if (length >= 0) {
        end = start + length;
    }
    else {
        end = map.size + length;
    }
    for (let [key, value] of map) {
        if ((index >= start) && (index < end)) {
            let newKey;
            // Note that array_slice() will reorder and reset the ***numeric*** array indices by default. [...]
            // see http://php.net/manual/en/function.array-slice.php
            if (typeof key === "number") {
                newKey = preserveKeys ? key : keyIndex;
                keyIndex++;
            }
            else {
                newKey = key;
            }
            result.set(newKey, value);
        }
        if (index >= end) {
            break;
        }
        index++;
    }
    return result;
}

/**
 * Slices a variable.
 *
 * @param _executionContext
 * @param item A variable
 * @param start Start of the slice
 * @param length Size of the slice
 * @param preserveKeys Whether to preserve key or not (when the input is an object)
 *
 * @returns {Promise<string | Map<any, any>>} The sliced variable
 */
const slice = (_executionContext, item, start, length, preserveKeys) => {
    if (isTraversable(item)) {
        const iterableItem = iteratorToMap(item);
        if (length === null) {
            length = iterableItem.size - start;
        }
        return Promise.resolve(sliceMap(iterableItem, start, length, preserveKeys));
    }
    item = '' + (item ? item : '');
    if (length === null) {
        length = item.length - start;
    }
    return Promise.resolve(item.substr(start, length));
};
const sliceSynchronously = (_executionContext, item, start, length, preserveKeys) => {
    if (isTraversable(item)) {
        const iterableItem = iteratorToMap(item);
        if (length === null) {
            length = iterableItem.size - start;
        }
        return sliceMap(iterableItem, start, length, preserveKeys);
    }
    item = '' + (item ? item : '');
    if (length === null) {
        length = item.length - start;
    }
    return item.substr(start, length);
};

const getFirstValue = (map) => {
    return Array.from(map.values())[0];
};

/**
 * Returns the first element of the item.
 *
 * @param executionContext
 * @param item
 *
 * @returns {Promise<any>} The first element of the item
 */
const first = (executionContext, item) => {
    return slice(executionContext, item, 0, 1, false)
        .then((elements) => {
        return typeof elements === 'string' ? elements : getFirstValue(elements);
    });
};
const firstSynchronously = (executionContext, item) => {
    const elements = sliceSynchronously(executionContext, item, 0, 1, false);
    return typeof elements === 'string' ? elements : getFirstValue(elements);
};

/**
 * Returns the last element of the item.
 *
 * @param executionContext
 * @param item A variable
 *
 * @returns The last element of the item
 */
const last = (executionContext, item) => {
    return slice(executionContext, item, -1, 1, false)
        .then((elements) => {
        return typeof elements === 'string' ? elements : getFirstValue(elements);
    });
};
const lastSynchronously = (executionContext, item) => {
    const elements = sliceSynchronously(executionContext, item, -1, 1, false);
    return typeof elements === 'string' ? elements : getFirstValue(elements);
};

/**
 * Checks if a variable is empty.
 *
 * <pre>
 * {# evaluates to true if the foo variable is null, false, or the empty string #}
 * {% if foo is empty %}
 *     {# ... #}
 * {% endif %}
 * </pre>
 *
 * @param executionContext
 * @param value A variable
 *
 * @returns {boolean} true if the value is empty, false otherwise
 */
const isEmpty = (executionContext, value) => {
    if (value === null || value === undefined) {
        return Promise.resolve(true);
    }
    if (typeof value === 'string') {
        return Promise.resolve(value.length < 1);
    }
    if (typeof value[Symbol.iterator] === 'function') {
        return Promise.resolve(value[Symbol.iterator]().next().done === true);
    }
    if (isPlainObject$1(value)) {
        if (value.hasOwnProperty('toString') && typeof value.toString === 'function') {
            return isEmpty(executionContext, value.toString());
        }
        else {
            return Promise.resolve(iteratorToArray(value).length < 1);
        }
    }
    if (typeof value === 'object' && value.toString && typeof value.toString === 'function') {
        return isEmpty(executionContext, value.toString());
    }
    return Promise.resolve(value === false);
};
const isEmptySynchronously = (executionContext, value) => {
    if (value === null || value === undefined) {
        return true;
    }
    if (typeof value === 'string') {
        return value.length < 1;
    }
    if (typeof value[Symbol.iterator] === 'function') {
        return value[Symbol.iterator]().next().done === true;
    }
    if (isPlainObject$1(value)) {
        if (value.hasOwnProperty('toString') && typeof value.toString === 'function') {
            return isEmptySynchronously(executionContext, value.toString());
        }
        else {
            return iteratorToArray(value).length < 1;
        }
    }
    if (typeof value === 'object' && value.toString && typeof value.toString === 'function') {
        return isEmptySynchronously(executionContext, value.toString());
    }
    return value === false;
};

const defaultFilter = (executionContext, value, defaultValue) => {
    return isEmpty(executionContext, value)
        .then((isEmpty) => {
        if (isEmpty) {
            return Promise.resolve(defaultValue);
        }
        else {
            return Promise.resolve(value);
        }
    });
};
const defaultFilterSynchronously = (executionContext, value, defaultValue) => {
    if (isEmptySynchronously(executionContext, value)) {
        return defaultValue;
    }
    return value;
};

const escape = (executionContext, value, strategy) => {
    if (strategy === null) {
        strategy = "html";
    }
    const { template, environment } = executionContext;
    // todo: probably we need to use traceable method
    return escapeValue(template, environment, value, strategy, environment.charset)
        .then((value) => {
        if (typeof value === "string") {
            return createMarkup(value, environment.charset);
        }
        return value;
    });
};
const escapeSynchronously = (executionContext, value, strategy) => {
    if (strategy === null) {
        strategy = "html";
    }
    const { template, environment } = executionContext;
    // todo: probably we need to use traceable method
    const escapedValue = escapeValueSynchronously(template, environment, value, strategy, environment.charset);
    if (typeof escapedValue === "string") {
        return createMarkup(escapedValue, environment.charset);
    }
    return escapedValue;
};

/**
 * Rounds a number.
 *
 * @param value The value to round
 * @param {number} precision The rounding precision
 * @param {string} method The method to use for rounding
 *
 * @returns {Promise<number>} The rounded number
 */
const round = (_executionContext, value, precision, method) => {
    const _do = () => {
        if (method === 'common') {
            return phpRound(value, precision);
        }
        if (method !== 'ceil' && method !== 'floor') {
            throw new Error('The round filter only supports the "common", "ceil", and "floor" methods.');
        }
        const intermediateValue = value * Math.pow(10, precision);
        const intermediateDivider = Math.pow(10, precision);
        if (method === 'ceil') {
            return phpCeil(intermediateValue) / intermediateDivider;
        }
        else {
            return phpFloor(intermediateValue) / intermediateDivider;
        }
    };
    try {
        const result = _do();
        return Promise.resolve(result);
    }
    catch (error) {
        return Promise.reject(error);
    }
};
const roundSynchronously = (_executionContext, value, precision, method) => {
    if (method === 'common') {
        return phpRound(value, precision);
    }
    if (method !== 'ceil' && method !== 'floor') {
        throw new Error('The round filter only supports the "common", "ceil", and "floor" methods.');
    }
    const intermediateValue = value * Math.pow(10, precision);
    const intermediateDivider = Math.pow(10, precision);
    if (method === 'ceil') {
        return phpCeil(intermediateValue) / intermediateDivider;
    }
    else {
        return phpFloor(intermediateValue) / intermediateDivider;
    }
};

/**
 * Returns the keys of the passed array.
 *
 * @param _executionContext
 * @param values An array
 *
 * @returns {Promise<Array<any>>} The keys
 */
const keys = (_executionContext, values) => {
    let traversable;
    if ((values === null) || (values === undefined)) {
        traversable = new Map();
    }
    else {
        traversable = iteratorToMap(values);
    }
    return Promise.resolve([...traversable.keys()]);
};
const keysSynchronously = (_executionContext, values) => {
    let traversable;
    if ((values === null) || (values === undefined)) {
        traversable = new Map();
    }
    else {
        traversable = iteratorToMap(values);
    }
    return [...traversable.keys()];
};

/**
 * Removes whitespaces between HTML tags.
 *
 * @return {Promise<TwingMarkup>}
 */
const spaceless = (_executionContext, content) => {
    return Promise.resolve(createMarkup(content.toString().replace(/>\s+</g, '><').trim()));
};
const spacelessSynchronously = (_executionContext, content) => {
    return createMarkup(content.toString().replace(/>\s+</g, '><').trim());
};

/**
 * Return the values from a single column in the input array.
 *
 * @param {*} thing An iterable
 * @param {*} columnKey The column key
 *
 * @return {Promise<Array<any>>} The array of values
 */
const column = (_executionContext, thing, columnKey) => {
    let map;
    if (!isTraversable(thing) || isPlainObject(thing)) {
        return Promise.reject(new Error(`The column filter only works with arrays or "Traversable", got "${typeof thing}" as first argument.`));
    }
    else {
        map = iteratorToMap(thing);
    }
    const result = [];
    for (const value of map.values()) {
        const valueAsMap = iteratorToMap(value);
        for (const [key, value] of valueAsMap) {
            if (key === columnKey) {
                result.push(value);
            }
        }
    }
    return Promise.resolve(result);
};
const columnSynchronously = (_executionContext, thing, columnKey) => {
    let map;
    if (!isTraversable(thing) || isPlainObject(thing)) {
        throw new Error(`The column filter only works with arrays or "Traversable", got "${typeof thing}" as first argument.`);
    }
    else {
        map = iteratorToMap(thing);
    }
    const result = [];
    for (const value of map.values()) {
        const valueAsMap = iteratorToMap(value);
        for (const [key, value] of valueAsMap) {
            if (key === columnKey) {
                result.push(value);
            }
        }
    }
    return result;
};

const filter = async (_executionContext, map, callback) => {
    const result = new Map();
    map = iteratorToMap(map);
    for (const [key, value] of map) {
        if (await callback(value)) {
            result.set(key, value);
        }
    }
    return Promise.resolve(result);
};
const filterSynchronously = (_executionContext, map, callback) => {
    const result = new Map();
    map = iteratorToMap(map);
    for (const [key, value] of map) {
        if (callback(value)) {
            result.set(key, value);
        }
    }
    return result;
};

const map = async (_executionContext, map, callback) => {
    const result = new Map();
    map = iteratorToMap(map);
    for (const [key, value] of map) {
        result.set(key, await callback(value, key));
    }
    return Promise.resolve(result);
};
const mapSynchronously = (_executionContext, map, callback) => {
    const result = new Map();
    map = iteratorToMap(map);
    for (const [key, value] of map) {
        result.set(key, callback(value, key));
    }
    return result;
};

const reduce = (_executionContext, map, callback, initial) => {
    map = iteratorToMap(map);
    const values = [...map.values()];
    return Promise.resolve(values.reduce((previousValue, currentValue) => {
        return (async () => callback(await previousValue, currentValue))();
    }, initial));
};
const reduceSynchronously = (_executionContext, map, callback, initial) => {
    map = iteratorToMap(map);
    const values = [...map.values()];
    return values.reduce((previousValue, currentValue) => {
        return (() => callback(previousValue, currentValue))();
    }, initial);
};

const range = (_executionContext, low, high, step) => {
    return Promise.resolve(createRange(low, high, step));
};
const rangeSynchronously = (_executionContext, low, high, step) => {
    return createRange(low, high, step);
};

function getConstant(context, name, object) {
    if (object) {
        return object[name];
    }
    else {
        return context.get(name);
    }
}

const constant = (executionContext, name, object) => {
    return Promise.resolve(getConstant(executionContext.context, name, object));
};
const constantSynchronously = (executionContext, name, object) => {
    return getConstant(executionContext.context, name, object);
};

/**
 * Cycles over a value.
 *
 * @param _executionContext
 * @param value
 * @param position The cycle position
 *
 * @returns The value at position
 */
const cycle = (_executionContext, value, position) => {
    if (!isAMapLike(value) && !Array.isArray(value)) {
        return Promise.resolve(value);
    }
    let values;
    let size;
    if (Array.isArray(value)) {
        values = value;
        size = value.length;
    }
    else {
        values = [...value.values()];
        size = value.size;
    }
    return Promise.resolve(values[position % size]);
};
const cycleSynchronously = (_executionContext, value, position) => {
    if (!isAMapLike(value) && !Array.isArray(value)) {
        return value;
    }
    let values;
    let size;
    if (Array.isArray(value)) {
        values = value;
        size = value.length;
    }
    else {
        values = [...value.values()];
        size = value.size;
    }
    return values[position % size];
};

/**
 * Returns a random value depending on the supplied parameter type:
 * - a random item from a Traversable or array
 * - a random character from a string
 * - a random integer between 0 and the integer parameter.
 *
 * @param executionContext
 * @param {*} values The values to pick a random item from
 * @param {number} max Maximum value used when values is an integer
 *
 * @throws TwingErrorRuntime when values is an empty array (does not apply to an empty string which is returned as is)
 *
 * @returns {Promise<any>} A random value from the given sequence
 */
const random = (executionContext, values, max) => {
    const { environment } = executionContext;
    const { charset } = environment;
    let _do = () => {
        if (values === null) {
            return max === null ? mt_rand() : mt_rand(0, max);
        }
        if (typeof values === 'number') {
            let min;
            if (max === null) {
                if (values < 0) {
                    max = 0;
                    min = values;
                }
                else {
                    max = values;
                    min = 0;
                }
            }
            else {
                min = values;
            }
            return mt_rand(min, max);
        }
        if (typeof values === 'string') {
            values = Buffer.from(values);
        }
        if (Buffer.isBuffer(values)) {
            if (values.toString() === '') {
                return '';
            }
            if (charset !== 'UTF-8') {
                values = iconv(charset, 'UTF-8', values);
            }
            // unicode split
            values = runes(values.toString());
            if (charset !== 'UTF-8') {
                values = values.map((value) => {
                    return iconv('UTF-8', charset, Buffer.from(value)).toString();
                });
            }
        }
        else if (isTraversable(values)) {
            values = iteratorToArray(values);
        }
        if (!Array.isArray(values)) {
            return values;
        }
        if (values.length < 1) {
            return Promise.reject(new Error('The random function cannot pick from an empty array.'));
        }
        return values[array_rand(values, 1)];
    };
    return Promise.resolve(_do());
};
const randomSynchronously = (executionContext, values, max) => {
    const { environment } = executionContext;
    const { charset } = environment;
    if (values === null) {
        return max === null ? mt_rand() : mt_rand(0, max);
    }
    if (typeof values === 'number') {
        let min;
        if (max === null) {
            if (values < 0) {
                max = 0;
                min = values;
            }
            else {
                max = values;
                min = 0;
            }
        }
        else {
            min = values;
        }
        return mt_rand(min, max);
    }
    if (typeof values === 'string') {
        values = Buffer.from(values);
    }
    if (Buffer.isBuffer(values)) {
        if (values.toString() === '') {
            return '';
        }
        if (charset !== 'UTF-8') {
            values = iconv(charset, 'UTF-8', values);
        }
        // unicode split
        values = runes(values.toString());
        if (charset !== 'UTF-8') {
            values = values.map((value) => {
                return iconv('UTF-8', charset, Buffer.from(value)).toString();
            });
        }
    }
    else if (isTraversable(values)) {
        values = iteratorToArray(values);
    }
    if (!Array.isArray(values)) {
        return values;
    }
    if (values.length < 1) {
        throw new Error('The random function cannot pick from an empty array.');
    }
    return values[array_rand(values, 1)];
};

/**
 * Returns a template content without rendering it.
 *
 * @param executionContext
 * @param name The template name
 * @param ignoreMissing Whether to ignore missing templates or not
 *
 * @return The template source
 */
const source = (executionContext, name, ignoreMissing) => {
    const { template } = executionContext;
    return template.loadTemplate(executionContext, name)
        .catch(() => {
        return null;
    })
        .then((template) => {
        if (!ignoreMissing && (template === null)) {
            throw createTemplateLoadingError([name]);
        }
        return (template === null || template === void 0 ? void 0 : template.source.code) || null;
    });
};
const sourceSynchronously = (executionContext, name, ignoreMissing) => {
    const { template } = executionContext;
    let loadedTemplate;
    try {
        loadedTemplate = template.loadTemplate(executionContext, name);
    }
    catch (error) {
        loadedTemplate = null;
    }
    if (!ignoreMissing && (loadedTemplate === null)) {
        throw createTemplateLoadingError([name]);
    }
    return (loadedTemplate === null || loadedTemplate === void 0 ? void 0 : loadedTemplate.source.code) || null;
};

const getAST = (executionContext, code, name) => {
    const { environment } = executionContext;
    return environment.parse(environment.tokenize(createSource(name || code, code)));
};
/**
 * Loads a template from a string.
 *
 * <pre>
 * {{ include(template_from_string("Hello {{ name }}")) }}
 * </pre>
 *
 * @param executionContext
 * @param code
 * @param name An optional name for the template to be used in error messages
 */
const templateFromString = (executionContext, code, name) => {
    const ast = getAST(executionContext, code, name);
    return Promise.resolve(createTemplate(ast));
};
const templateFromStringSynchronously = (executionContext, code, name) => {
    const ast = getAST(executionContext, code, name);
    return createSynchronousTemplate(ast);
};

const dump = (executionContext, ...vars) => {
    if (vars.length < 1) {
        const vars_ = new Map();
        return iterate(executionContext.context, (key, value) => {
            vars_.set(key, value);
            return Promise.resolve();
        }).then(() => {
            return createMarkup(varDump(vars_));
        });
    }
    return Promise.resolve(createMarkup(varDump(...vars)));
};
const dumpSynchronously = (executionContext, ...vars) => {
    if (vars.length < 1) {
        const vars_ = new Map();
        iterateSynchronously(executionContext.context, (key, value) => {
            vars_.set(key, value);
        });
        return createMarkup(varDump(vars_));
    }
    return createMarkup(varDump(...vars));
};

/**
 * Checks if a variable is traversable.
 *
 * <pre>
 * {# evaluates to true if the foo variable is an array or a traversable object #}
 * {% if foo is iterable %}
 *     {# ... #}
 * {% endif %}
 * </pre>
 *
 * @param value A variable
 *
 * @return {Promise<boolean>} true if the value is traversable
 */
const isIterable = (_executionContext, value) => {
    let _do = () => {
        /*
            Prevent `(null)[Symbol.iterator]`/`(undefined)[Symbol.iterator]` error,
            and return `false` instead.

            Note that `value` should only be `undefined` if it's been explicitly
            set to that (e.g., in the JavaScript that provided the calling template
            with the context). Values that are simply "not defined" will either have
            been coerced to `null` or thrown a "does not exist" runtime error before
            this function is called (depending on whether `strict_variables` is enabled).

            This *does* mean that an explicitly `undefined` value will return `false`
            instead of throwing an error if `strict_variables` is enabled, which is
            probably unexpected behavior, but short of some major refactoring to allow
            an environmental check here, the alternative is to have `undefined`
            throw an error even when `strict_variables` is disabled, and that unexpected
            behavior seems worse.
        */
        if (value === null || value === undefined) {
            return false;
        }
        // for Twig, a string is not traversable
        if (typeof value === 'string') {
            return false;
        }
        if (typeof value[Symbol.iterator] === 'function') {
            return true;
        }
        // in PHP objects are not iterable so we have to ensure that the test reflects that
        return false;
    };
    return Promise.resolve(_do());
};
const isIterableSynchronously = (_executionContext, value) => {
    /*
        Prevent `(null)[Symbol.iterator]`/`(undefined)[Symbol.iterator]` error,
        and return `false` instead.

        Note that `value` should only be `undefined` if it's been explicitly
        set to that (e.g., in the JavaScript that provided the calling template
        with the context). Values that are simply "not defined" will either have
        been coerced to `null` or thrown a "does not exist" runtime error before
        this function is called (depending on whether `strict_variables` is enabled).

        This *does* mean that an explicitly `undefined` value will return `false`
        instead of throwing an error if `strict_variables` is enabled, which is
        probably unexpected behavior, but short of some major refactoring to allow
        an environmental check here, the alternative is to have `undefined`
        throw an error even when `strict_variables` is disabled, and that unexpected
        behavior seems worse.
    */
    if (value === null || value === undefined) {
        return false;
    }
    // for Twig, a string is not traversable
    if (typeof value === 'string') {
        return false;
    }
    if (typeof value[Symbol.iterator] === 'function') {
        return true;
    }
    // in PHP objects are not iterable so we have to ensure that the test reflects that
    return false;
};

const isDefined = (_executionContext, value) => {
    return Promise.resolve(!!value);
};
const isDefinedSynchronously = (_executionContext, value) => {
    return !!value;
};

const isConstant = (executionContext, comparand, constant, object) => {
    return Promise.resolve(comparand === getConstant(executionContext.context, constant, object));
};
const isConstantSynchronously = (executionContext, comparand, constant, object) => {
    return comparand === getConstant(executionContext.context, constant, object);
};

const createSpaceshipNode = createBinaryNodeFactory("spaceship");

const getOperators = () => {
    return [
        createOperator('not', "UNARY", 50, (operands, line, column) => {
            return createNotNode(operands[0], line, column);
        }),
        createOperator('-', "UNARY", 500, (operands, line, column) => {
            return createNegativeNode(operands[0], line, column);
        }),
        createOperator('+', "UNARY", 500, (operands, line, column) => {
            return createPositiveNode(operands[0], line, column);
        }),
        createOperator('or', "BINARY", 10, (operands, line, column) => {
            return createOrNode(operands, line, column);
        }),
        createOperator('and', "BINARY", 15, (operands, line, column) => {
            return createAndNode(operands, line, column);
        }),
        createOperator('b-or', "BINARY", 16, (operands, line, column) => {
            return createBitwiseOrNode(operands, line, column);
        }),
        createOperator('b-xor', "BINARY", 17, (operands, line, column) => {
            return createBitwiseXorNode(operands, line, column);
        }),
        createOperator('b-and', "BINARY", 18, (operands, line, column) => {
            return createBitwiseAndNode(operands, line, column);
        }),
        createOperator('==', "BINARY", 20, (operands, line, column) => {
            return createIsEqualNode(operands, line, column);
        }),
        createOperator('!=', "BINARY", 20, (operands, line, column) => {
            return createIsNotEqualToNode(operands, line, column);
        }),
        createOperator('<=>', "BINARY", 20, (operands, line, column) => {
            return createSpaceshipNode(operands, line, column);
        }),
        createOperator('<', "BINARY", 20, (operands, line, column) => {
            return createIsLessThanNode(operands, line, column);
        }),
        createOperator('<=', "BINARY", 20, (operands, line, column) => {
            return createIsLessThanOrEqualToNode(operands, line, column);
        }),
        createOperator('>', "BINARY", 20, (operands, line, column) => {
            return createIsGreaterThanNode(operands, line, column);
        }),
        createOperator('>=', "BINARY", 20, (operands, line, column) => {
            return createIsGreaterThanOrEqualToNode(operands, line, column);
        }),
        createOperator('not in', "BINARY", 20, (operands, line, column) => {
            return createIsNotInNode(operands, line, column);
        }),
        createOperator('in', "BINARY", 20, (operands, line, column) => {
            return createIsInNode(operands, line, column);
        }),
        createOperator('matches', "BINARY", 20, (operands, line, column) => {
            return createMatchesNode(operands, line, column);
        }),
        createOperator('starts with', "BINARY", 20, (operands, line, column) => {
            return createStartsWithNode(operands, line, column);
        }),
        createOperator('ends with', "BINARY", 20, (operands, line, column) => {
            return createEndsWithNode(operands, line, column);
        }),
        createOperator('has some', "BINARY", 20, (operands, line, column) => {
            return createHasSomeNode(operands, line, column);
        }, "LEFT", 3),
        createOperator('has every', "BINARY", 20, (operands, line, column) => {
            return createHasEveryNode(operands, line, column);
        }, "LEFT", 3),
        createOperator('..', "BINARY", 25, (operands, line, column) => {
            return createRangeNode(operands, line, column);
        }),
        createOperator('+', "BINARY", 30, (operands, line, column) => {
            return createAddNode(operands, line, column);
        }),
        createOperator('-', "BINARY", 30, (operands, line, column) => {
            return createSubtractNode(operands, line, column);
        }),
        createOperator('~', "BINARY", 40, (operands, line, column) => {
            return createConcatenateNode(operands, line, column);
        }),
        createOperator('*', "BINARY", 60, (operands, line, column) => {
            return createMultiplyNode(operands, line, column);
        }),
        createOperator('/', "BINARY", 60, (operands, line, column) => {
            return createDivideNode(operands, line, column);
        }),
        createOperator('//', "BINARY", 60, (operands, line, column) => {
            return createDivideAndFloorNode(operands, line, column);
        }),
        createOperator('%', "BINARY", 60, (operands, line, column) => {
            return createModuloNode(operands, line, column);
        }),
        createOperator('**', "BINARY", 200, (operands, line, column) => {
            return createPowerNode(operands, line, column);
        }, "RIGHT"),
        createOperator('??', "BINARY", 300, (operands, line, column) => {
            return createNullishCoalescingNode(operands, line, column);
        }, "RIGHT")
    ];
};
const createCoreExtension = () => {
    return {
        get filters() {
            const escapeFilters = ['escape', 'e'].map((name) => {
                return createFilter(name, (escape), [
                    {
                        name: 'strategy',
                        defaultValue: null
                    },
                    {
                        name: 'charset',
                        defaultValue: null
                    }
                ]);
            });
            return [
                ...escapeFilters,
                createFilter('abs', abs, []),
                createFilter('batch', batch, [
                    {
                        name: 'size'
                    },
                    {
                        name: 'fill',
                        defaultValue: null
                    },
                    {
                        name: 'preserve_keys',
                        defaultValue: true
                    }
                ]),
                createFilter('capitalize', capitalize, []),
                createFilter('column', column, [
                    {
                        name: 'name'
                    }
                ]),
                createFilter('convert_encoding', (convertEncoding), [
                    {
                        name: 'to'
                    },
                    {
                        name: 'from'
                    }
                ]),
                createFilter('date', date, [
                    {
                        name: 'format',
                        defaultValue: null
                    },
                    {
                        name: 'timezone',
                        defaultValue: null
                    }
                ]),
                createFilter('date_modify', dateModify, [
                    {
                        name: 'modifier'
                    }
                ]),
                createFilter('default', defaultFilter, [
                    {
                        name: 'default',
                        defaultValue: null
                    }
                ]),
                createFilter('filter', filter, [
                    {
                        name: 'array'
                    },
                    {
                        name: 'arrow',
                        defaultValue: null
                    }
                ]),
                createFilter('first', first, []),
                createFilter('format', format, [], {
                    is_variadic: true
                }),
                createFilter('join', join, [
                    {
                        name: 'glue',
                        defaultValue: ''
                    },
                    {
                        name: 'and',
                        defaultValue: null
                    }
                ]),
                createFilter('json_encode', jsonEncode, [
                    {
                        name: 'options',
                        defaultValue: null
                    }
                ]),
                createFilter('keys', keys, []),
                createFilter('last', last, []),
                createFilter('length', length, []),
                createFilter('lower', lower, []),
                createFilter('map', map, [
                    {
                        name: 'arrow'
                    }
                ]),
                createFilter('merge', merge, [
                    {
                        name: 'source'
                    }
                ]),
                createFilter('nl2br', nl2br, []),
                createFilter('number_format', numberFormat, [
                    {
                        name: 'decimal',
                        defaultValue: null
                    },
                    {
                        name: 'decimal_point',
                        defaultValue: null
                    },
                    {
                        name: 'thousand_sep',
                        defaultValue: null
                    }
                ]),
                createFilter('raw', raw, []),
                createFilter('reduce', reduce, [
                    {
                        name: 'arrow'
                    },
                    {
                        name: 'initial',
                        defaultValue: null
                    }
                ]),
                createFilter('replace', replace, [
                    {
                        name: 'from'
                    }
                ]),
                createFilter('reverse', reverse, [
                    {
                        name: 'preserve_keys',
                        defaultValue: false
                    }
                ]),
                createFilter('round', round, [
                    {
                        name: 'precision',
                        defaultValue: 0
                    },
                    {
                        name: 'method',
                        defaultValue: 'common'
                    }
                ]),
                createFilter('slice', slice, [
                    {
                        name: 'start'
                    },
                    {
                        name: 'length',
                        defaultValue: null
                    },
                    {
                        name: 'preserve_keys',
                        defaultValue: false
                    }
                ]),
                createFilter('sort', sort, [{
                        name: 'arrow',
                        defaultValue: null
                    }]),
                createFilter('spaceless', spaceless, []),
                createFilter('split', split, [
                    {
                        name: 'delimiter'
                    },
                    {
                        name: 'limit',
                        defaultValue: null
                    }
                ]),
                createFilter('striptags', striptags, [
                    {
                        name: 'allowable_tags',
                        defaultValue: ''
                    }
                ]),
                createFilter('title', title, []),
                createFilter('trim', trim, [
                    {
                        name: 'character_mask',
                        defaultValue: null
                    },
                    {
                        name: 'side',
                        defaultValue: 'both'
                    }
                ]),
                createFilter('upper', upper, []),
                createFilter('url_encode', url_encode, []),
            ];
        },
        get functions() {
            return [
                createFunction('constant', constant, [
                    { name: 'name' },
                    { name: 'object', defaultValue: null }
                ]),
                createFunction('cycle', cycle, [
                    {
                        name: 'values'
                    },
                    {
                        name: 'position'
                    }
                ]),
                createFunction('date', date$1, [
                    {
                        name: 'date',
                        defaultValue: null
                    },
                    {
                        name: 'timezone',
                        defaultValue: null
                    }
                ]),
                createFunction('dump', dump, [], {
                    is_variadic: true
                }),
                createFunction('include', include, [
                    {
                        name: 'template'
                    },
                    {
                        name: 'variables',
                        defaultValue: {}
                    },
                    {
                        name: 'with_context',
                        defaultValue: true
                    },
                    {
                        name: 'ignore_missing',
                        defaultValue: false
                    },
                    {
                        name: 'sandboxed',
                        defaultValue: false
                    }
                ]),
                createFunction('max', max, [], {
                    is_variadic: true
                }),
                createFunction('min', min, [], {
                    is_variadic: true
                }),
                createFunction('random', random, [
                    {
                        name: 'values',
                        defaultValue: null
                    },
                    {
                        name: 'max',
                        defaultValue: null
                    }
                ]),
                createFunction('range', range, [
                    {
                        name: 'low'
                    },
                    {
                        name: 'high'
                    },
                    {
                        name: 'step',
                        defaultValue: 1
                    }
                ]),
                createFunction('source', source, [
                    {
                        name: 'name'
                    },
                    {
                        name: 'ignore_missing',
                        defaultValue: false
                    }
                ]),
                createFunction('template_from_string', templateFromString, [
                    {
                        name: 'template'
                    },
                    {
                        name: 'name',
                        defaultValue: null
                    }
                ])
            ];
        },
        get nodeVisitors() {
            return [];
        },
        get operators() {
            return [
                createOperator('not', "UNARY", 50, (operands, line, column) => {
                    return createNotNode(operands[0], line, column);
                }),
                createOperator('-', "UNARY", 500, (operands, line, column) => {
                    return createNegativeNode(operands[0], line, column);
                }),
                createOperator('+', "UNARY", 500, (operands, line, column) => {
                    return createPositiveNode(operands[0], line, column);
                }),
                createOperator('or', "BINARY", 10, (operands, line, column) => {
                    return createOrNode(operands, line, column);
                }),
                createOperator('and', "BINARY", 15, (operands, line, column) => {
                    return createAndNode(operands, line, column);
                }),
                createOperator('b-or', "BINARY", 16, (operands, line, column) => {
                    return createBitwiseOrNode(operands, line, column);
                }),
                createOperator('b-xor', "BINARY", 17, (operands, line, column) => {
                    return createBitwiseXorNode(operands, line, column);
                }),
                createOperator('b-and', "BINARY", 18, (operands, line, column) => {
                    return createBitwiseAndNode(operands, line, column);
                }),
                createOperator('==', "BINARY", 20, (operands, line, column) => {
                    return createIsEqualNode(operands, line, column);
                }),
                createOperator('!=', "BINARY", 20, (operands, line, column) => {
                    return createIsNotEqualToNode(operands, line, column);
                }),
                createOperator('<=>', "BINARY", 20, (operands, line, column) => {
                    return createSpaceshipNode(operands, line, column);
                }),
                createOperator('<', "BINARY", 20, (operands, line, column) => {
                    return createIsLessThanNode(operands, line, column);
                }),
                createOperator('<=', "BINARY", 20, (operands, line, column) => {
                    return createIsLessThanOrEqualToNode(operands, line, column);
                }),
                createOperator('>', "BINARY", 20, (operands, line, column) => {
                    return createIsGreaterThanNode(operands, line, column);
                }),
                createOperator('>=', "BINARY", 20, (operands, line, column) => {
                    return createIsGreaterThanOrEqualToNode(operands, line, column);
                }),
                createOperator('not in', "BINARY", 20, (operands, line, column) => {
                    return createIsNotInNode(operands, line, column);
                }),
                createOperator('in', "BINARY", 20, (operands, line, column) => {
                    return createIsInNode(operands, line, column);
                }),
                createOperator('matches', "BINARY", 20, (operands, line, column) => {
                    return createMatchesNode(operands, line, column);
                }),
                createOperator('starts with', "BINARY", 20, (operands, line, column) => {
                    return createStartsWithNode(operands, line, column);
                }),
                createOperator('ends with', "BINARY", 20, (operands, line, column) => {
                    return createEndsWithNode(operands, line, column);
                }),
                createOperator('has some', "BINARY", 20, (operands, line, column) => {
                    return createHasSomeNode(operands, line, column);
                }, "LEFT", 3),
                createOperator('has every', "BINARY", 20, (operands, line, column) => {
                    return createHasEveryNode(operands, line, column);
                }, "LEFT", 3),
                createOperator('..', "BINARY", 25, (operands, line, column) => {
                    return createRangeNode(operands, line, column);
                }),
                createOperator('+', "BINARY", 30, (operands, line, column) => {
                    return createAddNode(operands, line, column);
                }),
                createOperator('-', "BINARY", 30, (operands, line, column) => {
                    return createSubtractNode(operands, line, column);
                }),
                createOperator('~', "BINARY", 40, (operands, line, column) => {
                    return createConcatenateNode(operands, line, column);
                }),
                createOperator('*', "BINARY", 60, (operands, line, column) => {
                    return createMultiplyNode(operands, line, column);
                }),
                createOperator('/', "BINARY", 60, (operands, line, column) => {
                    return createDivideNode(operands, line, column);
                }),
                createOperator('//', "BINARY", 60, (operands, line, column) => {
                    return createDivideAndFloorNode(operands, line, column);
                }),
                createOperator('%', "BINARY", 60, (operands, line, column) => {
                    return createModuloNode(operands, line, column);
                }),
                createOperator('**', "BINARY", 200, (operands, line, column) => {
                    return createPowerNode(operands, line, column);
                }, "RIGHT"),
                createOperator('??', "BINARY", 300, (operands, line, column) => {
                    return createNullishCoalescingNode(operands, line, column);
                }, "RIGHT")
            ];
        },
        get tagHandlers() {
            return [];
        },
        get tests() {
            return [
                createTest('constant', isConstant, [
                    {
                        name: 'constant'
                    },
                    {
                        name: 'object',
                        defaultValue: null
                    }
                ]),
                createTest('divisible by', isDivisibleBy, [
                    {
                        name: 'divisor'
                    }
                ]),
                createTest('defined', isDefined, []),
                createTest('empty', isEmpty, []),
                createTest('even', isEven, []),
                createTest('iterable', isIterable, []),
                createTest('none', isNull, []),
                createTest('null', isNull, []),
                createTest('odd', isOdd, []),
                createTest('same as', isSameAs, [
                    {
                        name: 'comparand'
                    }
                ]),
            ];
        }
    };
};
const createSynchronousCoreExtension = () => {
    return {
        get filters() {
            const escapeFilters = ['escape', 'e'].map((name) => {
                return createSynchronousFilter(name, escapeSynchronously, [
                    {
                        name: 'strategy',
                        defaultValue: null
                    },
                    {
                        name: 'charset',
                        defaultValue: null
                    }
                ]);
            });
            return [
                ...escapeFilters,
                createSynchronousFilter('abs', absSynchronously, []),
                createSynchronousFilter('batch', batchSynchronously, [
                    {
                        name: 'size'
                    },
                    {
                        name: 'fill',
                        defaultValue: null
                    },
                    {
                        name: 'preserve_keys',
                        defaultValue: true
                    }
                ]),
                createSynchronousFilter('capitalize', capitalizeSynchronously, []),
                createSynchronousFilter('column', columnSynchronously, [
                    {
                        name: 'name'
                    }
                ]),
                createSynchronousFilter('convert_encoding', convertEncodingSynchronously, [
                    {
                        name: 'to'
                    },
                    {
                        name: 'from'
                    }
                ]),
                createSynchronousFilter('date', dateFilterSynchronously, [
                    {
                        name: 'format',
                        defaultValue: null
                    },
                    {
                        name: 'timezone',
                        defaultValue: null
                    }
                ]),
                createSynchronousFilter('date_modify', dateModifySynchronously, [
                    {
                        name: 'modifier'
                    }
                ]),
                createSynchronousFilter('default', defaultFilterSynchronously, [
                    {
                        name: 'default',
                        defaultValue: null
                    }
                ]),
                createSynchronousFilter('filter', filterSynchronously, [
                    {
                        name: 'array'
                    },
                    {
                        name: 'arrow',
                        defaultValue: null
                    }
                ]),
                createSynchronousFilter('first', firstSynchronously, []),
                createSynchronousFilter('format', formatSynchronously, [], {
                    is_variadic: true
                }),
                createSynchronousFilter('join', joinSynchronously, [
                    {
                        name: 'glue',
                        defaultValue: ''
                    },
                    {
                        name: 'and',
                        defaultValue: null
                    }
                ]),
                createSynchronousFilter('json_encode', jsonEncodeSynchronously, [
                    {
                        name: 'options',
                        defaultValue: null
                    }
                ]),
                createSynchronousFilter('keys', keysSynchronously, []),
                createSynchronousFilter('last', lastSynchronously, []),
                createSynchronousFilter('length', lengthSynchronously, []),
                createSynchronousFilter('lower', lowerSynchronously, []),
                createSynchronousFilter('map', mapSynchronously, [
                    {
                        name: 'arrow'
                    }
                ]),
                createSynchronousFilter('merge', mergeSynchronously, [
                    {
                        name: 'source'
                    }
                ]),
                createSynchronousFilter('nl2br', nl2brSynchronously, []),
                createSynchronousFilter('number_format', numberFormatSynchronously, [
                    {
                        name: 'decimal',
                        defaultValue: null
                    },
                    {
                        name: 'decimal_point',
                        defaultValue: null
                    },
                    {
                        name: 'thousand_sep',
                        defaultValue: null
                    }
                ]),
                createSynchronousFilter('raw', rawSynchronously, []),
                createSynchronousFilter('reduce', reduceSynchronously, [
                    {
                        name: 'arrow'
                    },
                    {
                        name: 'initial',
                        defaultValue: null
                    }
                ]),
                createSynchronousFilter('replace', replaceSynchronously, [
                    {
                        name: 'from'
                    }
                ]),
                createSynchronousFilter('reverse', reverseSynchronously, [
                    {
                        name: 'preserve_keys',
                        defaultValue: false
                    }
                ]),
                createSynchronousFilter('round', roundSynchronously, [
                    {
                        name: 'precision',
                        defaultValue: 0
                    },
                    {
                        name: 'method',
                        defaultValue: 'common'
                    }
                ]),
                createSynchronousFilter('slice', sliceSynchronously, [
                    {
                        name: 'start'
                    },
                    {
                        name: 'length',
                        defaultValue: null
                    },
                    {
                        name: 'preserve_keys',
                        defaultValue: false
                    }
                ]),
                createSynchronousFilter('sort', sortSynchronously, [{
                        name: 'arrow',
                        defaultValue: null
                    }]),
                createSynchronousFilter('spaceless', spacelessSynchronously, []),
                createSynchronousFilter('split', splitSynchronously, [
                    {
                        name: 'delimiter'
                    },
                    {
                        name: 'limit',
                        defaultValue: null
                    }
                ]),
                createSynchronousFilter('striptags', striptagsSynchronously, [
                    {
                        name: 'allowable_tags',
                        defaultValue: ''
                    }
                ]),
                createSynchronousFilter('title', titleSynchronously, []),
                createSynchronousFilter('trim', trimSynchronously, [
                    {
                        name: 'character_mask',
                        defaultValue: null
                    },
                    {
                        name: 'side',
                        defaultValue: 'both'
                    }
                ]),
                createSynchronousFilter('upper', upperSynchronously, []),
                createSynchronousFilter('url_encode', urlEncodeSynchronously, []),
            ];
        },
        get functions() {
            return [
                createSynchronousFunction('constant', constantSynchronously, [
                    { name: 'name' },
                    { name: 'object', defaultValue: null }
                ]),
                createSynchronousFunction('cycle', cycleSynchronously, [
                    {
                        name: 'values'
                    },
                    {
                        name: 'position'
                    }
                ]),
                createSynchronousFunction('date', dateSynchronously, [
                    {
                        name: 'date',
                        defaultValue: null
                    },
                    {
                        name: 'timezone',
                        defaultValue: null
                    }
                ]),
                createSynchronousFunction('dump', dumpSynchronously, [], {
                    is_variadic: true
                }),
                createSynchronousFunction('include', includeSynchronously, [
                    {
                        name: 'template'
                    },
                    {
                        name: 'variables',
                        defaultValue: {}
                    },
                    {
                        name: 'with_context',
                        defaultValue: true
                    },
                    {
                        name: 'ignore_missing',
                        defaultValue: false
                    },
                    {
                        name: 'sandboxed',
                        defaultValue: false
                    }
                ]),
                createSynchronousFunction('max', maxSynchronously, [], {
                    is_variadic: true
                }),
                createSynchronousFunction('min', minSynchronously, [], {
                    is_variadic: true
                }),
                createSynchronousFunction('random', randomSynchronously, [
                    {
                        name: 'values',
                        defaultValue: null
                    },
                    {
                        name: 'max',
                        defaultValue: null
                    }
                ]),
                createSynchronousFunction('range', rangeSynchronously, [
                    {
                        name: 'low'
                    },
                    {
                        name: 'high'
                    },
                    {
                        name: 'step',
                        defaultValue: 1
                    }
                ]),
                createSynchronousFunction('source', sourceSynchronously, [
                    {
                        name: 'name'
                    },
                    {
                        name: 'ignore_missing',
                        defaultValue: false
                    }
                ]),
                createSynchronousFunction('template_from_string', templateFromStringSynchronously, [
                    {
                        name: 'template'
                    },
                    {
                        name: 'name',
                        defaultValue: null
                    }
                ])
            ];
        },
        get nodeVisitors() {
            return [];
        },
        get operators() {
            return getOperators();
        },
        get tagHandlers() {
            return [];
        },
        get tests() {
            return [
                createSynchronousTest('constant', isConstantSynchronously, [
                    {
                        name: 'constant'
                    },
                    {
                        name: 'object',
                        defaultValue: null
                    }
                ]),
                createSynchronousTest('divisible by', isDivisibleBySynchronously, [
                    {
                        name: 'divisor'
                    }
                ]),
                createSynchronousTest('defined', isDefinedSynchronously, []),
                createSynchronousTest('empty', isEmptySynchronously, []),
                createSynchronousTest('even', isEvenSynchronously, []),
                createSynchronousTest('iterable', isIterableSynchronously, []),
                createSynchronousTest('none', isNullSynchronously, []),
                createSynchronousTest('null', isNullSynchronously, []),
                createSynchronousTest('odd', isOddSynchronously, []),
                createSynchronousTest('same as', isSameAsSynchronously, [
                    {
                        name: 'comparand'
                    }
                ]),
            ];
        }
    };
};

/**
 * Creates an instance of {@link TwingEnvironment} backed by the passed loader.
 *
 * @param loader
 * @param options
 */
const createEnvironment = (loader, options) => {
    const cssEscapingStrategy = createCssEscapingStrategyHandler();
    const htmlEscapingStrategy = createHtmlEscapingStrategyHandler();
    const htmlAttributeEscapingStrategy = createHtmlAttributeEscapingStrategyHandler();
    const jsEscapingStrategy = createJsEscapingStrategyHandler();
    const urlEscapingStrategy = createUrlEscapingStrategyHandler();
    const escapingStrategyHandlers = {
        css: cssEscapingStrategy,
        html: htmlEscapingStrategy,
        html_attr: htmlAttributeEscapingStrategy,
        js: jsEscapingStrategy,
        url: urlEscapingStrategy
    };
    const extensionSet = createExtensionSet();
    extensionSet.addExtension(createCoreExtension());
    const cache = (options === null || options === void 0 ? void 0 : options.cache) || null;
    const charset = (options === null || options === void 0 ? void 0 : options.charset) || 'UTF-8';
    const dateFormat = (options === null || options === void 0 ? void 0 : options.dateFormat) || 'F j, Y H:i';
    const dateIntervalFormat = (options === null || options === void 0 ? void 0 : options.dateIntervalFormat) || '%d days';
    const numberFormat = (options === null || options === void 0 ? void 0 : options.numberFormat) || {
        decimalPoint: '.',
        numberOfDecimals: 0,
        thousandSeparator: ','
    };
    const sandboxPolicy = (options === null || options === void 0 ? void 0 : options.sandboxPolicy) || createSandboxSecurityPolicy();
    const globals = createContext(iterableToMap((options === null || options === void 0 ? void 0 : options.globals) || {}));
    let lexer;
    let parser;
    const environment = {
        get cache() {
            return cache;
        },
        get charset() {
            return charset;
        },
        get dateFormat() {
            return dateFormat;
        },
        get dateIntervalFormat() {
            return dateIntervalFormat;
        },
        get escapingStrategyHandlers() {
            return escapingStrategyHandlers;
        },
        get filters() {
            return extensionSet.filters;
        },
        get functions() {
            return extensionSet.functions;
        },
        get globals() {
            return globals;
        },
        get loader() {
            return loader;
        },
        get numberFormat() {
            return numberFormat;
        },
        get sandboxPolicy() {
            return sandboxPolicy;
        },
        get tests() {
            return extensionSet.tests;
        },
        get timezone() {
            return (options === null || options === void 0 ? void 0 : options.timezone) || luxon.Settings.defaultZoneName;
        },
        addExtension: extensionSet.addExtension,
        addFilter: extensionSet.addFilter,
        addFunction: extensionSet.addFunction,
        addNodeVisitor: extensionSet.addNodeVisitor,
        addOperator: extensionSet.addOperator,
        addTagHandler: extensionSet.addTagHandler,
        addTest: extensionSet.addTest,
        loadTemplate: async (name, from = null) => {
            const templateLoader = createTemplateLoader(environment);
            return templateLoader(name, from)
                .then((template) => {
                if (template === null) {
                    throw createTemplateLoadingError([name]);
                }
                return template;
            });
        },
        registerEscapingStrategy: (handler, name) => {
            escapingStrategyHandlers[name] = handler;
        },
        parse: (stream, parserOptions) => {
            if (!parser) {
                const visitors = extensionSet.nodeVisitors;
                if (options === null || options === void 0 ? void 0 : options.autoEscapingStrategy) {
                    const strategy = options.autoEscapingStrategy;
                    visitors.unshift({
                        enterNode: (node) => {
                            return node;
                        },
                        leaveNode: (node) => {
                            if (node.type === "template") {
                                node.children.body = createAutoEscapeNode(strategy, node.children.body, node.line, node.column);
                            }
                            return node;
                        }
                    });
                }
                parser = createParser(extensionSet.unaryOperators, extensionSet.binaryOperators, extensionSet.tagHandlers, extensionSet.nodeVisitors, extensionSet.filters, extensionSet.functions, extensionSet.tests, parserOptions || (options === null || options === void 0 ? void 0 : options.parserOptions) || {
                    strict: true,
                    level: 3
                });
            }
            return parser.parse(stream);
        },
        render: (name, context, options) => {
            return environment.loadTemplate(name)
                .then((template) => {
                return template.render(environment, context, options);
            });
        },
        renderWithSourceMap: (name, context, options) => {
            const sourceMapRuntime = createSourceMapRuntime();
            return environment.loadTemplate(name)
                .then((template) => {
                return template.render(environment, context, Object.assign(Object.assign({}, options), { sourceMapRuntime }));
            })
                .then((data) => {
                const { sourceMap } = sourceMapRuntime;
                return {
                    data,
                    sourceMap
                };
            });
        },
        tokenize: (source) => {
            var _a;
            const level = ((_a = options === null || options === void 0 ? void 0 : options.parserOptions) === null || _a === void 0 ? void 0 : _a.level) || 3;
            if (!lexer) {
                lexer = createLexer(level, extensionSet.binaryOperators, extensionSet.unaryOperators);
            }
            const stream = lexer.tokenizeSource(source);
            return createTokenStream(stream.toAst(), stream.source);
        }
    };
    return environment;
};
const createSynchronousEnvironment = (loader, options) => {
    const cssEscapingStrategy = createCssEscapingStrategyHandler();
    const htmlEscapingStrategy = createHtmlEscapingStrategyHandler();
    const htmlAttributeEscapingStrategy = createHtmlAttributeEscapingStrategyHandler();
    const jsEscapingStrategy = createJsEscapingStrategyHandler();
    const urlEscapingStrategy = createUrlEscapingStrategyHandler();
    const escapingStrategyHandlers = {
        css: cssEscapingStrategy,
        html: htmlEscapingStrategy,
        html_attr: htmlAttributeEscapingStrategy,
        js: jsEscapingStrategy,
        url: urlEscapingStrategy
    };
    const extensionSet = createExtensionSet();
    extensionSet.addExtension(createSynchronousCoreExtension());
    const cache = (options === null || options === void 0 ? void 0 : options.cache) || null;
    const charset = (options === null || options === void 0 ? void 0 : options.charset) || 'UTF-8';
    const dateFormat = (options === null || options === void 0 ? void 0 : options.dateFormat) || 'F j, Y H:i';
    const dateIntervalFormat = (options === null || options === void 0 ? void 0 : options.dateIntervalFormat) || '%d days';
    const numberFormat = (options === null || options === void 0 ? void 0 : options.numberFormat) || {
        decimalPoint: '.',
        numberOfDecimals: 0,
        thousandSeparator: ','
    };
    const sandboxPolicy = (options === null || options === void 0 ? void 0 : options.sandboxPolicy) || createSandboxSecurityPolicy();
    const globals = new Map(Object.entries((options === null || options === void 0 ? void 0 : options.globals) || {}));
    let lexer;
    let parser;
    const environment = {
        get cache() {
            return cache;
        },
        get charset() {
            return charset;
        },
        get dateFormat() {
            return dateFormat;
        },
        get dateIntervalFormat() {
            return dateIntervalFormat;
        },
        get escapingStrategyHandlers() {
            return escapingStrategyHandlers;
        },
        get filters() {
            return extensionSet.filters;
        },
        get functions() {
            return extensionSet.functions;
        },
        get globals() {
            return globals;
        },
        get loader() {
            return loader;
        },
        get numberFormat() {
            return numberFormat;
        },
        get sandboxPolicy() {
            return sandboxPolicy;
        },
        get tests() {
            return extensionSet.tests;
        },
        get timezone() {
            return (options === null || options === void 0 ? void 0 : options.timezone) || luxon.Settings.defaultZoneName;
        },
        addExtension: extensionSet.addExtension,
        addFilter: extensionSet.addFilter,
        addFunction: extensionSet.addFunction,
        addNodeVisitor: extensionSet.addNodeVisitor,
        addOperator: extensionSet.addOperator,
        addTagHandler: extensionSet.addTagHandler,
        addTest: extensionSet.addTest,
        loadTemplate: (name, from = null) => {
            const templateLoader = createSynchronousTemplateLoader(environment);
            const template = templateLoader(name, from);
            if (template === null) {
                throw createTemplateLoadingError([name]);
            }
            return template;
        },
        registerEscapingStrategy: (handler, name) => {
            escapingStrategyHandlers[name] = handler;
        },
        parse: (stream, parserOptions) => {
            if (!parser) {
                const visitors = extensionSet.nodeVisitors;
                if (options === null || options === void 0 ? void 0 : options.autoEscapingStrategy) {
                    const strategy = options.autoEscapingStrategy;
                    visitors.unshift({
                        enterNode: (node) => {
                            return node;
                        },
                        leaveNode: (node) => {
                            if (node.type === "template") {
                                node.children.body = createAutoEscapeNode(strategy, node.children.body, node.line, node.column);
                            }
                            return node;
                        }
                    });
                }
                parser = createParser(extensionSet.unaryOperators, extensionSet.binaryOperators, extensionSet.tagHandlers, extensionSet.nodeVisitors, extensionSet.filters, extensionSet.functions, extensionSet.tests, parserOptions || (options === null || options === void 0 ? void 0 : options.parserOptions) || {
                    strict: true,
                    level: 3
                });
            }
            return parser.parse(stream);
        },
        render: (name, data, options) => {
            const template = environment.loadTemplate(name);
            const context = new Map(Object.entries(data));
            return renderSynchronousTemplate(template, environment, context, options);
        },
        renderWithSourceMap: (name, data, options) => {
            const sourceMapRuntime = createSourceMapRuntime();
            const context = new Map(Object.entries(data));
            const template = environment.loadTemplate(name);
            const output = renderSynchronousTemplate(template, environment, context, Object.assign(Object.assign({}, options), { sourceMapRuntime }));
            const { sourceMap } = sourceMapRuntime;
            return {
                data: output,
                sourceMap
            };
        },
        tokenize: (source) => {
            var _a;
            const level = ((_a = options === null || options === void 0 ? void 0 : options.parserOptions) === null || _a === void 0 ? void 0 : _a.level) || 3;
            if (!lexer) {
                lexer = createLexer(level, extensionSet.binaryOperators, extensionSet.unaryOperators);
            }
            const stream = lexer.tokenizeSource(source);
            return createTokenStream(stream.toAst(), stream.source);
        }
    };
    return environment;
};

exports.createAddNode = createAddNode;
exports.createAndNode = createAndNode;
exports.createApplyNode = createApplyNode;
exports.createApplyTagHandler = createApplyTagHandler;
exports.createArrayLoader = createArrayLoader;
exports.createArrayNode = createArrayNode;
exports.createArrowFunctionNode = createArrowFunctionNode;
exports.createAssignmentNode = createAssignmentNode;
exports.createAttributeAccessorNode = createAttributeAccessorNode;
exports.createAutoEscapeNode = createAutoEscapeNode;
exports.createAutoEscapeTagHandler = createAutoEscapeTagHandler;
exports.createBaseArrayNode = createBaseArrayNode;
exports.createBaseBinaryNode = createBaseBinaryNode;
exports.createBaseCallNode = createBaseCallNode;
exports.createBaseConditionalNode = createBaseConditionalNode;
exports.createBaseIncludeNode = createBaseIncludeNode;
exports.createBaseNode = createBaseNode;
exports.createBaseUnaryNode = createBaseUnaryNode;
exports.createBitwiseAndNode = createBitwiseAndNode;
exports.createBitwiseOrNode = createBitwiseOrNode;
exports.createBitwiseXorNode = createBitwiseXorNode;
exports.createBlockFunctionNode = createBlockFunctionNode;
exports.createBlockNode = createBlockNode;
exports.createBlockReferenceNode = createBlockReferenceNode;
exports.createBlockTagHandler = createBlockTagHandler;
exports.createChainLoader = createChainLoader;
exports.createCheckSecurityNode = createCheckSecurityNode;
exports.createCheckToStringNode = createCheckToStringNode;
exports.createCommentNode = createCommentNode;
exports.createConcatenateNode = createConcatenateNode;
exports.createConditionalNode = createConditionalNode;
exports.createConstantNode = createConstantNode;
exports.createContext = createContext;
exports.createDeprecatedNode = createDeprecatedNode;
exports.createDeprecatedTagHandler = createDeprecatedTagHandler;
exports.createDivideAndFloorNode = createDivideAndFloorNode;
exports.createDivideNode = createDivideNode;
exports.createDoNode = createDoNode;
exports.createDoTagHandler = createDoTagHandler;
exports.createEmbedNode = createEmbedNode;
exports.createEmbedTagHandler = createEmbedTagHandler;
exports.createEndsWithNode = createEndsWithNode;
exports.createEnvironment = createEnvironment;
exports.createEscapeNode = createEscapeNode;
exports.createExtendsTagHandler = createExtendsTagHandler;
exports.createExtensionSet = createExtensionSet;
exports.createFilesystemLoader = createFilesystemLoader;
exports.createFilter = createFilter;
exports.createFilterNode = createFilterNode;
exports.createFilterTagHandler = createFilterTagHandler;
exports.createFlushNode = createFlushNode;
exports.createFlushTagHandler = createFlushTagHandler;
exports.createForLoopNode = createForLoopNode;
exports.createForNode = createForNode;
exports.createForTagHandler = createForTagHandler;
exports.createFromTagHandler = createFromTagHandler;
exports.createFunction = createFunction;
exports.createFunctionNode = createFunctionNode;
exports.createHasEveryNode = createHasEveryNode;
exports.createHasSomeNode = createHasSomeNode;
exports.createHashNode = createHashNode;
exports.createIfNode = createIfNode;
exports.createIfTagHandler = createIfTagHandler;
exports.createImportNode = createImportNode;
exports.createImportTagHandler = createImportTagHandler;
exports.createIncludeNode = createIncludeNode;
exports.createIncludeTagHandler = createIncludeTagHandler;
exports.createIsEqualNode = createIsEqualNode;
exports.createIsGreaterThanNode = createIsGreaterThanNode;
exports.createIsGreaterThanOrEqualToNode = createIsGreaterThanOrEqualToNode;
exports.createIsInNode = createIsInNode;
exports.createIsLessThanNode = createIsLessThanNode;
exports.createIsLessThanOrEqualToNode = createIsLessThanOrEqualToNode;
exports.createIsNotEqualToNode = createIsNotEqualToNode;
exports.createIsNotInNode = createIsNotInNode;
exports.createLexer = createLexer;
exports.createLineNode = createLineNode;
exports.createLineTagHandler = createLineTagHandler;
exports.createMacroNode = createMacroNode;
exports.createMacroTagHandler = createMacroTagHandler;
exports.createMarkup = createMarkup;
exports.createMatchesNode = createMatchesNode;
exports.createMethodCallNode = createMethodCallNode;
exports.createModuloNode = createModuloNode;
exports.createMultiplyNode = createMultiplyNode;
exports.createNameNode = createNameNode;
exports.createNegativeNode = createNegativeNode;
exports.createNode = createNode;
exports.createNotNode = createNotNode;
exports.createNullishCoalescingNode = createNullishCoalescingNode;
exports.createOperator = createOperator;
exports.createOrNode = createOrNode;
exports.createOutputBuffer = createOutputBuffer;
exports.createParentFunctionNode = createParentFunctionNode;
exports.createParsingError = createParsingError;
exports.createPositiveNode = createPositiveNode;
exports.createPowerNode = createPowerNode;
exports.createPrintNode = createPrintNode;
exports.createRangeNode = createRangeNode;
exports.createRuntimeError = createRuntimeError;
exports.createSandboxNode = createSandboxNode;
exports.createSandboxSecurityPolicy = createSandboxSecurityPolicy;
exports.createSandboxTagHandler = createSandboxTagHandler;
exports.createSetNode = createSetNode;
exports.createSetTagHandler = createSetTagHandler;
exports.createSource = createSource;
exports.createSourceMapRuntime = createSourceMapRuntime;
exports.createSpacelessNode = createSpacelessNode;
exports.createSpacelessTagHandler = createSpacelessTagHandler;
exports.createSpreadNode = createSpreadNode;
exports.createStartsWithNode = createStartsWithNode;
exports.createSubtractNode = createSubtractNode;
exports.createSynchronousArrayLoader = createSynchronousArrayLoader;
exports.createSynchronousChainLoader = createSynchronousChainLoader;
exports.createSynchronousEnvironment = createSynchronousEnvironment;
exports.createSynchronousFilesystemLoader = createSynchronousFilesystemLoader;
exports.createSynchronousFilter = createSynchronousFilter;
exports.createSynchronousFunction = createSynchronousFunction;
exports.createSynchronousTemplate = createSynchronousTemplate;
exports.createSynchronousTemplateLoader = createSynchronousTemplateLoader;
exports.createSynchronousTest = createSynchronousTest;
exports.createTemplate = createTemplate;
exports.createTemplateLoader = createTemplateLoader;
exports.createTemplateLoadingError = createTemplateLoadingError;
exports.createTemplateNode = createTemplateNode;
exports.createTest = createTest;
exports.createTestNode = createTestNode;
exports.createTextNode = createTextNode;
exports.createTraitNode = createTraitNode;
exports.createUseTagHandler = createUseTagHandler;
exports.createVerbatimNode = createVerbatimNode;
exports.createVerbatimTagHandler = createVerbatimTagHandler;
exports.createWithNode = createWithNode;
exports.createWithTagHandler = createWithTagHandler;
exports.executeNode = executeNode;
exports.executeNodeSynchronously = executeNodeSynchronously;
exports.getChildren = getChildren;
exports.getChildrenCount = getChildrenCount;
exports.isAMarkup = isAMarkup;
exports.isATwingError = isATwingError;
