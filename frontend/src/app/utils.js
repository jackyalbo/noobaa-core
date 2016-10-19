/*global setImmediate */

export function noop() {
}

// TODO: deprecate
export function invokeAsync(f, ...params) {
    setTimeout(
        () => f(...params),
        0
    );
}

export function isArray(value){
    return value instanceof Array;
}

export function isNumber(value) {
    return typeof value === 'number' || value instanceof Number;
}

export function isString(value) {
    return typeof value === 'string' || value instanceof String;
}

export function isFunction(value) {
    return typeof value === 'function';
}

export function isObject(value) {
    return typeof value === 'object' && value !== null;
}

export function isUndefined(value) {
    return typeof value === 'undefined';
}

export function isDefined(value) {
    return !isUndefined(value);
}

export function toCammelCase(str) {
    return str.replace(/-\w/g, match => match[1].toUpperCase());
}

export function toDashedCase(str) {
    return str.replace(/[A-Z]+/g, match => `-${match.toLowerCase()}`);
}


const sizeUnits = [' bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB' ];

export function formatSize(num) {
    const peta = Math.pow(1024, 5);

    let i = 0;
    if (!isNumber(num)) {
        if (num.peta > 0) {
            i = 5;
            num = num.peta + num.n / peta;
        } else {
            num = num.n;
        }
    }

    while (num / 1024 >= 1) {
        num /= 1024;
        ++i;
    }

    if (i > 0) {
        num = num.toFixed(num < 10 ? 1 : 0);
    }

    return `${num}${sizeUnits[i]}`;
}

export function formatDuration(minutes) {
    let hours = minutes / 60 | 0;
    let days = hours / 24 | 0;
    hours %= 24;
    minutes %= 60;

    return [
        days > 0 ? `${days} day${days > 1 ? 's' : ''}` : null,
        hours > 0 ? `${hours} hour${hours > 1 ? 's' : ''}` : null,
        minutes > 0 ? `${minutes} minute${minutes > 1 ? 's' : ''}` : null
    ]
        .filter(
            part => part
        )
        .reduce(
            (str, part, i, parts) =>
                str + (i === parts.length - 1 ? ' and ' : ', ') + parts
        );
}

export function randomString(len = 8) {
    var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    return makeArray(
        len,
        () => possible.charAt(Math.random() * possible.length | 0)
    ).join('');
}

export function parseQueryString(str) {
    return decodeURIComponent(str)
        .replace(/(^\?)/,'')
        .split('&')
        .filter(part => part)
        .reduce( (result, part) => {
            let [name, value] = part.split('=');
            result[toCammelCase(name)] = value || true;
            return result;
        }, {});
}

export function stringifyQueryString(query) {
    return Object.keys(query)
        .reduce((list, key) => {
            if (!isUndefined(query[key])) {
                let encodedName = encodeURIComponent(toDashedCase(key));
                let value = query[key] === true ?
                    encodedName :
                    `${encodedName}=${encodeURIComponent(query[key])}`;

                list.push(value);
            }

            return list;
        }, [])
        .join('&');
}

export function realizeUri(template, params = {}, query = {}) {
    let search = stringifyQueryString(query);
    let base = template
        .split('/')
        .map(
            part => {
                let isParam = part[0] === ':';
                let isOptional = part.substr(-1) === '?';

                if (isParam) {
                    let name = part.substr(1, part.length - 1 - Number(isOptional));
                    let value = params[name ];

                    if (value) {
                        return encodeURIComponent(value);
                    } else if (isOptional) {
                        return null;
                    } else {
                        throw new Error(`Cannot satisfy mandatory parameter: ${name}`);
                    }
                } else {
                    return part;
                }
            }
        )
        .filter(
            part => part !== null
        )
        .join('/');

    return search ? `${base}?${search}` : base;
}

export function throttle(func, grace, owner) {
    let handle = null;
    return function(...args) {
        clearTimeout(handle);
        handle = setTimeout(() => func.apply(owner || this, args), grace);
    };
}

export function compare(a, b) {
    return a < b ? -1 : ( b < a ? 1 : 0);
}

export function createCompareFunc(accessor, factor = 1) {
    return (a,b) => factor * compare(accessor(a), accessor(b));
}

export function equalNoCase(str1, str2) {
    return str1.toLowerCase() === str2.toLowerCase();
}

export function copyTextToClipboard(text) {
    // Prevent XSS attacks.
    let doc = new DOMParser().parseFromString(text, 'text/html');
    text = doc.body.textContent;

    let input = document.createElement('textarea');
    document.body.appendChild(input);
    input.value = text;
    input.focus();
    input.select();
    document.execCommand('Copy');
    input.remove();
}

export function downloadFile(url) {
    let body = window.document.body;

    let link = window.document.createElement('a');
    link.download = '';
    link.href = url;
    body.appendChild(link);
    link.click();

    setImmediate(
        () => body.removeChild(link)
    );
}

export function makeArray(size, initializer) {
    if (typeof initializer !== 'function') {
        let val = initializer;
        initializer = () => val;
    }

    let array = [];
    for (let i = 0; i < size; ++i) {
        array.push(initializer(i));
    }
    return array;
}

export function makeRange(start, end) {
    if (isUndefined(end)) {
        if (start < 0) {
            throw new TypeError('Invalid count');
        }

        end = start - 1;
        start = 0;
    }

    let dir = start > end ? -1 : 1;
    let count = Math.abs(end - start + dir);

    return makeArray(
        count,
        i => i * dir + start
    );
}

export function domFromHtml(html) {
    // Switched to template element because DOMParser did not parsed
    // <tr>, <td>, <option> and <li> elements as root elements.
    let template = document.createElement('template');
    template.innerHTML = html;
    return template.content.childNodes;
}

export function encodeBase64(obj) {
    return btoa(JSON.stringify(obj));
}

export function last(arr) {
    return arr[arr.length - 1];
}

export function clamp(num, min, max) {
    return Math.max(min, Math.min(num, max));
}

export function execInOrder(list, executer) {
    let result = Promise.resolve();

    for (let i = 0; i < list.length; ++i) {
        result = result.then(
            res => res === true || executer(list[i], i)
        );
    }

    return result;
}

// TODO: deprecate
export function defineEnum(...values) {
    return Object.freeze(
        values.reduce(
            (enm, val) => {
                enm[val.toString()] = val;
                return val;
            },
            {}
        )
    );
}

export function generateAccessKeys() {
    return {
        access_key: randomString(16),
        secret_key: randomString(32)
    };
}

export function lastSegment(str, delimiter) {
    return str.substr(str.lastIndexOf(delimiter) + 1);
}

export function avgOp(avg, value, i) {
    return avg + (value - avg) / (i + 1);
}

export function shortString(str, maxLength = 25, suffixLengh = 5) {
    if (str.length <= maxLength){
        return str;
    }

    return `${
        str.substr(0, maxLength - (suffixLengh + 3))
    }...${
        str.substr(-suffixLengh)
    }`;
}

// TODO: deprecate
export function toOwnKeyValuePair(obj) {
    return Object.keys(obj)
        .map(
            key => ({ key: key, value: obj[key] })
        );
}

export function bitsToNumber(...bits) {
    return bits.reduce(
        (number, bit) => number << 1 | (!!bit | 0),
        0
    );
}

export function pad(str, size, char = '0') {
    return (char.repeat(size) + str).substr(-size);
}

export function deepFreeze(val) {
    if (isObject(val) && !Object.isFrozen(val)) {
        Object.keys(val).forEach(
            key => { val[key] = deepFreeze(val[key]); }
        );
        return Object.freeze(val);
    } else {
        return val;
    }
}

export function sleep(miliseconds, wakeValue) {
    return new Promise(
        resolve => setTimeout(
            () => resolve(wakeValue),
            miliseconds
        )
    );
}

// TODO: deprecate
export function areSame(a, b) {
    return a === b;
}

export function capitalize(str) {
    return str[0].toUpperCase() + str.substr(1);
}

export function flatMap(arr, predicate) {
    return arr.reduce(
        (result, item) => {
            let mappedValue = predicate(item);

            if (isArray(mappedValue)) {
                result.push(...mappedValue);
            } else {
                result.push(mappedValue);
            }

            return result;
        },
        []
    );
}

export function recognizeBrowser() {
    const userAgentTokens = [
        'chrome', 'chromium', 'firefox', 'edge', 'msie', 'safari', 'opr'
    ];

    let userAgent = navigator.userAgent.toLowerCase();
    return  userAgentTokens.find(
        token => userAgent.includes(token)
    );
}


export function isLowerCase(str) {
    return str.toLowerCase() === str;
}

export function isUpperCase(str) {
    return str.toUpperCase() === str;
}

export function isLetter(str) {
    return letters.includes(str.toLowerCase());
}

export function isDigit(str) {
    return !isNaN(Number(str)) && str.length === 1;
}

export function getColorChannels(color) {
    const regExp = /#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})/;

    let [, ...channels] = color.match(regExp).map(
            hex => parseInt(hex, 16)
    );

    return channels;
}

export function rgbToColor(r,g,b) {
    return `#${
        pad(r.toString(16), 2)
    }${
        pad(g.toString(16), 2)
    }${
        pad(b.toString(16), 2)
    }`;
}

export function tweenColors(ratio, ...colors){
    if (colors.length === 1) {
        return colors[0];
    }

    let scaledRatio = ratio * (colors.length - 1);
    let lowerBound = Math.floor(scaledRatio);
    let upperBound = Math.ceil(scaledRatio);
    let tweenValue = scaledRatio - lowerBound;

    let [r1, g1, b1] = getColorChannels(colors[lowerBound]);
    let [r2, g2, b2] = getColorChannels(colors[upperBound]);

    let r = ((r1 + (r2 - r1) * tweenValue) | 0);
    let g = ((g1 + (g2 - g1) * tweenValue) | 0);
    let b = ((b1 + (b2 - b1) * tweenValue) | 0);

    return rgbToColor(r,g,b);
}

const letters = 'abcdefghijklmnopqrstuvwxyz';
const symbols = ')!@#$%^&*(';

// TODO: Move the section below to password-utils
export function calcPasswordStrength(password) {
    let charsInfo = Array.from(password).map(
        char => {
            let digit = isDigit(char);
            let letter = isLetter(char);
            let symbol = !digit && !letter;
            let upperCase = isUpperCase(char);
            let lowerCase = isLowerCase(char);
            let place = !letter ?
                (symbol ? symbols.indexOf(char) : Number(char)) :
                letters.indexOf(char.toLowerCase());


            return { digit, letter, symbol, upperCase, lowerCase, place };
        }
    );

    let counts = charsInfo.reduce(
        (counts, charInfo) => {
            counts.upperCase += charInfo.upperCase && charInfo.letter ? 1 : 0;
            counts.lowerCase += charInfo.lowerCase && charInfo.letter ? 1 : 0;
            counts.symbol += charInfo.symbol ? 1 : 0;
            counts.digit += charInfo.digit ? 1 : 0;
            counts.letter += charInfo.letter ? 1 : 0;
            return counts;
        },
        {
            upperCase: 0,
            lowerCase: 0,
            symbol: 0,
            digit: 0,
            letter: 0
        }
    );

    let score = 0;

    //  Number of Characters : +(n*4)
    score += charsInfo.length * 4;

    // Uppercase Letters : +((len-n)*2)
    score += counts.upperCase ?
        (charsInfo.length - counts.upperCase) * 2 :
        0;

    // Lowercase Letters : +((len-n)*2)
    score += counts.lowerCase ?
        (charsInfo.length - counts.lowerCase) * 2 :
        0;

    // Numbers : +(n*4)
    score += counts.digit * 4;

    // Symbols : +(n*6)
    score += counts.symbol * 6;

    // Middle Numbers or Symbols : +(n*2)
    score += (counts.digit + counts.symbol) * 2;
    score -= charsInfo[0].digit || charsInfo[0].symbol ? 2 : 0;
    score -= last(charsInfo).digit || last(charsInfo).symbol ? 2 : 0;

    // Requirements : +(n*2)
    // Minimum 8 characters in length
    // Contains 3/4 of the following items:
    // - Uppercase Letters
    // - Lowercase Letters
    // - Numbers
    // - Symbols
    let checkedRequirements = 0;
    checkedRequirements += Number(counts.digit > 0) + Number(counts.upperCase > 0) +
        Number(counts.lowerCase > 0) + Number(counts.symbol > 0);
    if (checkedRequirements >=3 && charsInfo.length >= 8)
        score += (checkedRequirements + 1) * 2;

    //Letters Only : -n
    score -= charsInfo.length === counts.letter ? counts.letter : 0;

    // Numbers Only : -n
    score -= charsInfo.length === counts.digit ? counts.digit : 0;

    // Consecutive Uppercase Letters  : -(n*2)
    score -= charsInfo.reduce(
        (inc, currInfo, i) => {
            if(i < 1) return inc;

            let lastChar = charsInfo[i - 1];
            return inc + Number(currInfo.letter && currInfo.upperCase &&
                lastChar.letter && lastChar.upperCase) * 2;
        },
        0
    );

    // Consecutive Lowercase Letters : -(n*2)
    score -= charsInfo.reduce(
        (inc, currInfo, i) => {
            if(i < 1) return inc;

            let lastChar = charsInfo[i - 1];
            return inc + Number(currInfo.letter && currInfo.lowerCase &&
                lastChar.letter && lastChar.lowerCase) * 2;
        },
        0
    );

    // Consecutive Numbers : -(n*2)
    score -= charsInfo.reduce(
        (inc, currInfo, i) => {
            if(i < 1) return inc;

            let lastChar = charsInfo[i - 1];
            return inc + Number(currInfo.digit && lastChar.digit) * 2;
        },
        0
    );

    // Sequential Letters (3+) : -(n*3)
    score -= charsInfo.reduce(
        (inc, currInfo, i) => {
            if(i < 2) return inc;

            let last1 = charsInfo[i - 1];
            let last2 = charsInfo[i - 2];
            if(!last2.letter || !last1.letter || !currInfo.letter) {
                return inc;
            }

            let diff = last2.place - last1.place;
            let diff2 = last1.place - currInfo.place;
            let delta = (Math.abs(diff) === 1 && diff === diff2) ? 3 : 0;
            return inc + delta;
        },
        0
    );

    // Sequential Numbers (3+) : -(n*3)
    score -= charsInfo.reduce(
        (inc, currInfo, i) => {
            if(i < 2) return inc;

            let last1 = charsInfo[i - 1];
            let last2 = charsInfo[i - 2];
            if(!last2.digit || !last1.digit || !currInfo.digit) {
                return inc;
            }

            let diff = last2.place - last1.place;
            let diff2 = last1.place - currInfo.place;
            let delta = (Math.abs(diff) === 1 && diff === diff2) ? 3 : 0;
            return inc + delta;
        },
        0
    );
    // Sequential Symbols (3+) : -(n*3)
    score -= charsInfo.reduce(
        (inc, currInfo, i) => {
            if(i < 2) return inc;

            let last1 = charsInfo[i - 1];
            let last2 = charsInfo[i - 2];
            if(!last2.symbol || !last1.symbol || !currInfo.symbol) {
                return inc;
            }

            let diff = last2.place - last1.place;
            let diff2 = last1.place - currInfo.place;
            let delta = (Math.abs(diff) === 1 && diff === diff2) ? 3 : 0;
            return inc + delta;
        },
        0
    );
    // Repeat Characters (Case Insensitive)
    let uniquesCount = password.length;
    score -= Array.from(password).reduce(
        (inc, char, i) => {
            let delta = 0;

            let j = password.indexOf(char);
            while(j > -1) {
                if (j !== i) {
                    delta += password.length / Math.abs(j - i);
                }

                j = password.indexOf(char, j + 1);
            }

            if (delta > 0) {
                inc += delta;

                if (--uniquesCount) {
                    inc /= uniquesCount;
                }
            }

            return Math.ceil(inc);
        },
        0
    );

    return clamp(score/100, 0, 1);
}

// HTTP GET request as a promise.
export function httpGetAsync(url) {
    return new Promise(
        (resolve, reject) =>  {
            let xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);

            xhr.onerror = reject;
            xhr.onabort = reject;

            xhr.onload = function(evt) {
                xhr.status === 200 ? resolve(evt) : reject(evt);
            };

            xhr.send();
        }
    );
}
