const vscode = require("vscode");
const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

let vsCodeUserSettingsPath;
let isInsiders = /insiders/i.test(process.argv0);
let isCodium = /codium/i.test(process.argv0);
let isOSS = /vscode-oss/i.test(__dirname);
let CodeDir = isInsiders
	? "Code - Insiders"
	: isCodium
	? "VSCodium"
	: isOSS
	? "Code - OSS"
	: "Code";
let isPortable = process.env.VSCODE_PORTABLE ? true : false;
if (isPortable) {
	vsCodeUserSettingsPath = process.env.VSCODE_PORTABLE + `/user-data/User/`;
} else {
	switch (os.type()) {
		case "Darwin":
			vsCodeUserSettingsPath = process.env.HOME + `/Library/Application Support/${CodeDir}/User/`;
			break;
		case "Linux":
			vsCodeUserSettingsPath = process.env.HOME + `/.config/${CodeDir}/User/`;
			break;
		case "Windows_NT":
			vsCodeUserSettingsPath = process.env.APPDATA + `\\${CodeDir}\\User\\`;
			break;
		default:
			vsCodeUserSettingsPath = process.env.HOME + `/.config/${CodeDir}/User/`;
			break;
	}
}
function getVsCodeSnippetsPath() {
	let config = vscode.workspace.getConfiguration("easySnippet");
	let snippetsPath = config.get("snippetsPath");
	return snippetsPath || path.join(vsCodeUserSettingsPath, "snippets");
}
exports.getVsCodeSnippetsPath = getVsCodeSnippetsPath;

let json_caches = {};
function clearCaches() {
	json_caches = {};
}
exports.clearCaches = clearCaches;
function readJson(filename) {
	let cache = json_caches[filename] || {};
	let stat = fs.statSync(filename);
	if (cache && cache.t >= stat.mtime.getTime()) return cache.data;
	let text = fs.readFileSync(filename, "utf8");
	cache.data = new Function("return " + text)();
	cache.t = stat.mtime.getTime();
	json_caches[filename] = cache;
	return cache.data;
}
exports.readJson = readJson;
function getSelectedText() {
	let editor = vscode.window.activeTextEditor;
	if (!editor) return "";
	let content = editor.document.getText(editor.selection);
	let lines = content.split("\n");
	let minIndent = Infinity;
	for (let line of lines) {
		let indent = line.match(/^\s*/)[0].length;
		if (indent < minIndent) minIndent = indent;
	}
	if (minIndent != Infinity) {
		content = lines.map((x) => x.slice(minIndent)).join("\n");
	}
	return content;
}
exports.getSelectedText = getSelectedText;
function insertContent(content) {
	let editor = vscode.window.activeTextEditor;
	let snippet = {
		"${1:snippet name}": {
			prefix: "${2:$1}",
			body: content.split("\n"),
			description: "${3:$1}",
		},
	};
	let s = JSON.stringify(snippet, null, 4);
	editor.insertSnippet(new vscode.SnippetString(s), editor.selection);
}
exports.insertContent = insertContent;
function endSelection(document) {
	let maxLine = document.lineCount - 1;
	let endChar = document.lineAt(maxLine).range.end.character;
	let position = new vscode.Position(maxLine, endChar);
	return new vscode.Selection(position, position);
}
exports.endSelection = endSelection;
function selectAllRange(document) {
	let maxLine = document.lineCount - 1;
	let endChar = document.lineAt(maxLine).range.end.character;
	return new vscode.Range(0, 0, maxLine, endChar);
}
exports.selectAllRange = selectAllRange;
function getLanguageConfig(languageId) {
	// reference https://github.com/Microsoft/vscode/issues/2871#issuecomment-338364014
	var langConfigFilepath = null;
	for (const _ext of vscode.extensions.all) {
		if (_ext.packageJSON.contributes && _ext.packageJSON.contributes.languages) {
			// Find language data from "packageJSON.contributes.languages" for the languageId
			const packageLangData = _ext.packageJSON.contributes.languages.find(
				(_packageLangData) => _packageLangData.id === languageId
			);
			// If found, get the absolute config file path
			if (packageLangData && packageLangData.configuration) {
				langConfigFilepath = path.join(_ext.extensionPath, packageLangData.configuration);
				break;
			}
		}
	}
	// Validate config file existance
	if (!!langConfigFilepath && fs.existsSync(langConfigFilepath)) {
		return readJson(langConfigFilepath);
	}
}
exports.getLanguageConfig = getLanguageConfig;
/**
 * 获取指定lang的行内注释
 * @param {string} languageId
 * @param {string} [def]
 **/
function getLineComment(languageId, def = "//") {
	let config = getLanguageConfig(languageId);
	return (config && config.comments && config.comments.lineComment) || def;
}
exports.getLineComment = getLineComment;
function getCurrentLanguage() {
	let editor = vscode.window.activeTextEditor;
	if (editor) return editor.document.languageId;
}
exports.getCurrentLanguage = getCurrentLanguage;
async function getLanguages(additionalLanguages) {
	let languages = await vscode.languages.getLanguages();
	if (additionalLanguages) languages = languages.concat(additionalLanguages);
	let set = new Set(languages);
	if (set.has("vue")) set.add("vue-html");
	let currentLanguage = getCurrentLanguage();
	if (currentLanguage) set.delete(currentLanguage);
	languages = Array.from(set);
	languages.sort();
	if (currentLanguage) languages.unshift(currentLanguage);
	let items = languages.map((label) => {
		if (label === currentLanguage) return {label, description: "current language"};
		return {label};
	});
	return items;
}
exports.getLanguages = getLanguages;
function snippet2text(snippet, languageId) {
	if (!languageId && snippet.scope) languageId = snippet.scope.split(",")[0];
	let comment = getLineComment(languageId);
	let text = "";
	let keys = ["filepath", "key"].filter((k) => snippet[k]);
	if (keys.length) keys.push("scope");
	keys.push("prefix", "description");
	for (let key of keys) {
		let v = snippet[key] || "";
		let arr = Array.isArray(v) ? v : [v];
		for (let one of arr) {
			let k = "@" + key;
			for (let item of one.split("\n")) {
				text += `${comment} ${k} ${item}\n`;
				if (k[0] != " ") k = Array.from(k).fill(" ").join("");
			}
		}
	}
	let config = vscode.workspace.getConfiguration("easySnippet");
	let lintDisableHeader = config.get("lintDisableHeader");
	if (lintDisableHeader[languageId]) text += lintDisableHeader[languageId] + "\n";
	text += "\n";
	if (snippet.body instanceof Array) text += snippet.body.join("\n");
	else text += snippet.body || "";
	return text;
}
exports.snippet2text = snippet2text;

/**
 * @param {string} text
 * @param {string} languageId
 */
function text2snippet(text, languageId) {
	let comment = getLineComment(languageId);
	let config = vscode.workspace.getConfiguration("easySnippet");
	let lintDisableHeader = config.get("lintDisableHeader");
	let headers = new Set(
		Object.values(lintDisableHeader)
			.map((x) => x && x.trim())
			.filter((x) => x)
	);
	let snippet = {};
	let lines = text.split("\n").filter((x) => !headers.has(x.trim()));
	let body = "";
	for (let i = 0; i < lines.length; i++) {
		if (!lines[i].startsWith(comment)) {
			body = lines.slice(i);
			while (body[0] == "") body.shift();
			lines = lines.slice(0, i);
			break;
		}
	}
	let prev;
	let key;
	for (let line of lines) {
		line = line.slice(comment.length);
		let m = /^\s*@\w+\s*/.exec(line);
		if (m) {
			prev = m[0];
			key = prev.trim().slice(1);
			if (Array.isArray(snippet[key])) snippet[key].push(line.slice(prev.length));
			else if (snippet[key]) snippet[key] = [snippet[key], line.slice(prev.length)];
			else snippet[key] = line.slice(prev.length);
		} else if (prev) {
			let s = line.startsWith(" ".repeat(prev.length)) ? line.slice(prev.length) : line.trimStart();
			let arr = snippet[key];
			if (Array.isArray(arr)) arr[arr.length - 1] += "\n" + s;
			else snippet[key] += "\n" + s;
		}
	}
	snippet.body = body;
	return snippet;
}
exports.text2snippet = text2snippet;

function md5(s) {
	return crypto.createHash("md5").update(s).digest("hex");
}
exports.md5 = md5;

function confirm(msg) {
	return vscode.window
		.showQuickPick(["No", "Yes"], {
			placeHolder: msg,
		})
		.then((flag) => flag == "Yes");
}
exports.confirm = confirm;
