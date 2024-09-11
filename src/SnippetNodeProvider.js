const vscode = require("vscode");
const utils = require("../common/utils");
const fs = require("fs");
const path = require("path");
const os = require("os");
const cjson = require("comment-json");

class SnippetNodeProvider {
	constructor() {
		this._onDidChangeTreeData = new vscode.EventEmitter();
		this.onDidChangeTreeData = this._onDidChangeTreeData.event;
		this.caches = {};
		/** @type {vscode.TreeView} */
		this.tree;
	}

	getSnippets(languageId) {
		let filename = this.snippetPath(languageId);
		let stat;
		try {
			stat = fs.statSync(filename);
		} catch (error) {
			return {data: {}, list: []};
		}
		let cache = this.caches[languageId] || {};
		if (cache && cache.t >= stat.mtime.getTime()) return cache;
		console.log("read", filename);
		let text = fs.readFileSync(filename, "utf8");
		let data = cjson.parse(text);
		let list = [];
		for (let key in data) {
			let v = data[key];
			let label = key;
			let description = v.description;
			let contextValue = "snippet";
			let command = {
				command: "snippetExplorer.editSnippet",
				arguments: [{languageId, key}],
				title: "Edit Snippet.",
			};
			list.push({label, description, languageId, contextValue, command});
		}
		list.sort((a, b) => (a.label > b.label ? 1 : -1));
		cache.t = stat.mtime.getTime();
		cache.list = list;
		cache.data = data;
		return (this.caches[languageId] = cache);
	}

	getDragData(node) {
		if (node.contextValue != "snippet") return;
		let cache = this.getSnippets(node.languageId);
		let snippet = cache.data[node.label];
		return {
			...snippet,
			scope: node.languageId,
			key: node.label,
			languageId: node.languageId,
			type: "snippetExplorer",
		};
	}

	async onDrop(target, data) {
		let {prefix, body, description, key} = data;
		let languageId = target.languageId || target.label;
		if (languageId == data.languageId) return;
		let cache = this.getSnippets(languageId);
		if (cache.data[key]) {
			if (!(await utils.confirm("Are you sure? overwrite snippet: " + key))) return;
		}
		return await this.saveSnippet(
			{
				languageId,
				key,
				prefix,
				body,
				description,
			},
			true
		);
	}

	getSnippet(languageId, key) {
		let cache = this.getSnippets(languageId);
		return cache.data[key];
	}

	refresh() {
		this._onDidChangeTreeData.fire();
	}

	async search() {
		let currentLanguage = utils.getCurrentLanguage();
		let items = this.getChildren().map(({label}) => ({
			label: label,
			description: label == currentLanguage ? "current language" : "",
		}));
		if (currentLanguage) {
			items.sort((a, b) => {
				if (a.description) return -1;
				if (b.description) return 1;
				return a.label > b.label ? 1 : -1;
			});
		}
		let languageId = await vscode.window
			.showQuickPick(items, {placeHolder: "please select snippet language"})
			.then((x) => x && x.label);
		if (!languageId) return;
		if (!this.caches[languageId]) this.getSnippets(languageId);
		if (!this.caches[languageId])
			return vscode.window.showErrorMessage(`no snippet in language: ${languageId}`);
		let list = this.caches[languageId].list;
		let item = await vscode.window.showQuickPick(list, {placeHolder: "please select snippet"});
		let key = item.label;
		this.tree.reveal({languageId, label: key});
		this.editSnippet({key, languageId});
	}

	getTreeItem(element) {
		return element;
	}

	getChildren(element) {
		if (!element) {
			let filenames = fs.readdirSync(utils.getVsCodeSnippetsPath());
			return filenames
				.filter((x) => x.endsWith(".json"))
				.map((x) => ({
					label: x.slice(0, -5),
					contextValue: "group",
					collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
				}));
		}
		if (element.contextValue == "group") {
			let cache = this.getSnippets(element.label);
			return cache.list;
		}
	}

	getParent(e) {
		if (e.languageId) {
			return {label: e.languageId};
		}
	}

	snippetPath(languageId) {
		return path.join(utils.getVsCodeSnippetsPath(), languageId + ".json");
	}

	async pickLanguage() {
		let items = await utils.getLanguages(this.getChildren().map((x) => x.label));
		let languageId = await vscode.window
			.showQuickPick(items, {
				placeHolder: "please select snippet language",
			})
			.then((x) => x && x.label);
		return languageId;
	}

	async pickSnippet(e) {
		e = e || {};
		if (!e.languageId) {
			e.languageId = await this.pickLanguage();
			if (!e.languageId) return;
		}
		if (!e.key && !e.label) {
			let cache = this.getSnippets(e.languageId);
			let list = cache.list;
			let item = await vscode.window.showQuickPick(list, {
				placeHolder: list.length
					? "please select snippet"
					: "no snippet in " + e.languageId + ", please add first",
			});
			if (!item) return;
			e.key = e.label = item.label;
		}
		e.label = e.label || e.key;
		return e;
	}

	async addGroup() {
		let set = new Set(this.getChildren().map((x) => x.label));
		let items = await utils.getLanguages();
		items = items.filter((x) => !set.has(x.label));
		let languageId = await vscode.window
			.showQuickPick(items, {
				placeHolder: "please select snippet language",
			})
			.then((x) => x && x.label);
		if (!languageId) return;
		let filename = this.snippetPath(languageId);
		if (!fs.existsSync(filename)) fs.writeFileSync(filename, "{}");
		this.refresh();
		this.addSnippet({label: languageId});
	}

	/**
	 * @param {{label:string}} item
	 */
	async addSnippet(item, def) {
		let languageId = (item && item.label) || (await this.pickLanguage());
		if (!languageId) return;
		if (!def) {
			let text = utils.getSelectedText();
			if (text) def = {body: text.replace(/\$/g, "\\$")};
		}
		let key = await vscode.window.showInputBox({placeHolder: "snippet key"});
		if (key) {
			this.editSnippet({languageId, key}, def);
			this.refresh();
		}
	}
	async editGroup(item) {
		let languageId = (item && item.label) || (await this.pickLanguage());
		if (!languageId) return;
		let filename = this.snippetPath(languageId);
		let url = vscode.Uri.file(filename);
		const fs = vscode.workspace.fs;
		if (!(await fs.stat(url).catch(() => false))) {
			await fs.writeFile(url, Buffer.from("{}"));
		}
		vscode.window.showTextDocument(url);
	}
	async deleteGroup(item) {
		let languageId = (item && item.label) || (await this.pickLanguage());
		if (!languageId) return;
		if (!(await utils.confirm(`Are you sure? delete snippet "${languageId}.json"`))) return;
		let filename = this.snippetPath(languageId);
		fs.unlinkSync(filename);
		this.refresh();
	}
	/**
	 * @param {{label:string,languageId:string}} e
	 */
	async deleteSnippet(e, isForce) {
		e = await this.pickSnippet(e);
		if (!e) return;
		if (
			!isForce &&
			!(await utils.confirm(`Are you sure? delete snippet "${e.label}.${e.languageId}"`))
		)
			return;
		let cache = this.getSnippets(e.languageId);
		if (!cache.data[e.label]) return;
		let filename = this.snippetPath(e.languageId);
		delete cache.data[e.label];
		fs.writeFileSync(filename, cjson.stringify(cache.data, null, 2), "utf8");
		cache.list = cache.list.filter((x) => x.label != e.label);
		cache.t = +new Date();
		this.refresh();
	}
	/**
	 * @param {{label:string,languageId:string}} e
	 */
	async renameSnippet(e) {
		e = await this.pickSnippet(e);
		if (!e) return;
		let cache = this.getSnippets(e.languageId);
		if (!cache.data[e.label])
			return vscode.window.showErrorMessage(`not found snippet: ${e.label}`);
		let name = await vscode.window.showInputBox({placeHolder: "rename snippet"});
		if (!name) return;
		if (name == e.label) return;
		if (cache.data[name]) {
			if (!(await utils.confirm(`Are you sure? overwrite snippet "${name}"`))) return;
			cache.list = cache.list.filter((x) => x.label != name);
		}
		let filename = this.snippetPath(e.languageId);
		cache.data[name] = cache.data[e.label];
		delete cache.data[e.label];
		let child = cache.list.find((x) => x.label == e.label);
		if (child) {
			child.label = name;
			child.command.arguments[0].key = name;
		}
		fs.writeFileSync(filename, cjson.stringify(cache.data, null, 2), "utf8");
		cache.t = +new Date();
		this.refresh();
		this.editSnippet({languageId: e.languageId, key: name});
	}
	/**
	 * @param {{key:string,languageId:string}} e
	 * @param {Snippet} def new snippet template
	 */
	async editSnippet(e, def) {
		e = await this.pickSnippet(e);
		if (!e) return;
		def = Object.assign({prefix: e.key, body: ""}, def);
		let snippet = this.getSnippet(e.languageId, e.key);
		if (!snippet) snippet = def;
		if (!snippet.prefix) snippet.prefix = def.prefix;
		let text = utils.snippet2text(snippet, e.languageId);

		let filename = path.join(
			os.tmpdir(),
			Buffer.from(e.key).toString("base64").replace(/\//g, "-") + "." + e.languageId + ".snippet"
		);
		let content;
		if (!fs.existsSync(filename)) fs.writeFileSync(filename, (content = text));
		let editor = await vscode.window.showTextDocument(vscode.Uri.file(filename));
		await vscode.languages.setTextDocumentLanguage(editor.document, e.languageId).catch(() => {});
		let range = utils.selectAllRange(editor.document);
		if (content == null) content = editor.document.getText(range);
		if (content == text) return;
		await editor.edit((eb) => {
			eb.replace(range, text);
		});
		editor.selection = utils.endSelection(editor.document);
	}

	/**
	 * 保存代码片段
	 */
	saveSnippet(data, isDrog) {
		let {languageId, key, ...snippet} = data;
		let filename = this.snippetPath(languageId);
		let cache = this.getSnippets(languageId);
		if (!snippet.prefix) {
			vscode.window.showErrorMessage("@prefix is required");
			return;
		}
		if (!snippet.body || !snippet.body.length) {
			vscode.window.showErrorMessage("snippet body can't be empty");
			return;
		}
		if (cache.data[key]) Object.assign(cache.data[key], snippet);
		else cache.data[key] = snippet;
		if (!cache.data[key].description) delete cache.data[key].description;
		fs.writeFileSync(filename, cjson.stringify(cache.data, null, 2), "utf8");
		let item = cache.list.find((x) => x.label == key);
		if (item) item.description = snippet.description;
		else {
			cache.list.push({
				label: key,
				description: snippet.description,
				languageId,
				contextValue: "snippet",
				command: {
					command: "snippetExplorer.editSnippet",
					arguments: [{languageId, key}],
					title: "Edit Snippet.",
				},
			});
			cache.list.sort((a, b) => (a.label > b.label ? 1 : -1));
		}
		cache.t = +new Date();
		if (!isDrog)
			vscode.window.showInformationMessage(`snippet "${key}.${languageId}" save success`);
		this.refresh();
		this.tree.reveal({languageId, label: key});
		return true;
	}
}

module.exports = SnippetNodeProvider;
