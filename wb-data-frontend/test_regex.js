const fullText = "SELECT * FROM users t1 where t1.";
const aliasRegex = /(?:FROM|JOIN)\s+([a-zA-Z0-9_]+)(?:\s+AS)?\s+([a-zA-Z0-9_]+)/gi;
let match;
const aliases = {};
const reservedWords = new Set(['WHERE', 'ON', 'GROUP', 'ORDER', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'JOIN', 'SELECT', 'LIMIT', 'HAVING']);
while ((match = aliasRegex.exec(fullText)) !== null) {
    const tableName = match[1].toLowerCase();
    const aliasName = match[2].toLowerCase();
    console.log("Found match:", match[1], match[2]);
    if (!reservedWords.has(aliasName.toUpperCase())) {
        aliases[aliasName] = tableName;
    }
}
console.log("Aliases obj:", aliases);

const lineContent = "SELECT * FROM users t1 where t1.";
const positionColumn = 32;
const textBeforeCursor = lineContent.substring(0, positionColumn - 1);
console.log("textBeforeCursor:", textBeforeCursor);
const parts = textBeforeCursor.trim().split(/[\s,()=<>]+/);
console.log("parts:", parts);
const lastPart = parts[parts.length - 1]; // "t1."
const identifier = lastPart.split('.')[0].toLowerCase(); // "t1"
console.log("identifier:", identifier);
console.log("actualTableName:", aliases[identifier] || identifier);
