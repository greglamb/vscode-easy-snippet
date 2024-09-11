const vscode = require("vscode");
const utils = require("../common/utils");
const fs = require("fs");
const path = require("path");
const os = require("os");
const cjson = require("comment-json");

class SnippetScopeNodeProvider {
	constructor() {
		this._onDidChangeTreeData = new vscode.EventEmitter();
		this.onDidChangeTreeData = this._onDidChangeTreeData.event;
		this.caches = {};
		this.data = [];
		/** @type {vscode.TreeView} */
		this.tree;
	}

	openFile(filepath, text) {
		if (!filepath.endsWith(".code-snippets")) return;
		console.log("openFile", filepath);
		let label = path.basename(filepath, ".code-snippets");
		try {
			if (!text) text = fs.readFileSync(filepath, "utf8");
		} catch (error) {
			text = "{}";
		}
		let item = this.data.find((item) => item.filepath == filepath);
		if (!item) {
			item = {
				label,
				filepath,
				description: filepath,
				tooltip: filepath,
				collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
				contextValue: "group",
			};
			this.data.push(item);
		}
		if (item.text == text) return;
		let data = cjson.parse(text);
		let children = [];
		for (let key in data) {
			let v = data[key];
			children.push({
				label: key,
				parent: item,
				contextValue: "snippet",
				description: v.description,
				command: {
					command: "snippetScopeExplorer.editSnippet",
					arguments: [{filepath, key}],
					title: "Edit Snippet.",
				},
			});
		}
		item.text = text;
		item.data = data;
		item.children = children.sort((a, b) => (a.label > b.label ? 1 : -1));
		this._onDidChangeTreeData.fire();
	}

	getDragData(node) {
		if (!node.parent) return;
		return {
			...node.parent.data[node.label],
			key: node.label,
			filepath: node.parent.filepath,
			type: "snippetScopeExplorer",
		};
	}

	async onDrop(target, data) {
		let {prefix, body, description, scope, key} = data;
		let group = target.parent || target;
		if (group.filepath == data.filepath) return;
		if (group.data[key]) {
			if (!(await utils.confirm("Are you sure? overwrite snippet: " + key))) return;
		}
		return await this.saveSnippet(
			{
				filepath: group.filepath,
				key,
				prefix,
				body,
				description,
				scope,
			},
			true
		);
	}

	refresh() {
		this.data = [];
		// active file
		let editor = vscode.window.activeTextEditor;
		if (editor) {
			let doc = editor.document;
			this.openFile(doc.fileName, doc.getText());
		}
		// workspace
		let fs = vscode.workspace.fs;
		for (let folder of vscode.workspace.workspaceFolders || []) {
			console.log("scan folder:", folder.uri.fsPath);
			fs.readDirectory(vscode.Uri.file(path.join(folder.uri.fsPath, ".vscode"))).then((list) => {
				list.forEach(([filepath, type]) => {
					if (type != vscode.FileType.File) return;
					this.openFile(path.join(folder.uri.fsPath, ".vscode", filepath));
				});
			});
		}
		// global
		let url = vscode.Uri.file(utils.getVsCodeSnippetsPath());
		fs.readDirectory(url).then((list) => {
			list.forEach(([filepath, type]) => {
				if (type != vscode.FileType.File) return;
				this.openFile(path.join(url.fsPath, filepath));
			});
		});
	}

	async search() {
		if (!this.data.length) {
			let ret = await vscode.window.showInformationMessage(
				"no snippet file found, please create a snippet file first",
				"Create Snippet File"
			);
			if (ret == "Create Snippet File") {
				await this.addGroup();
			}
			return;
		}
		let parent = await vscode.window.showQuickPick(this.data, {placeHolder: "select snippet file"});
		if (!parent) return;
		let key;
		if (!parent.children.length) {
			vscode.window.showInformationMessage("no snippet in this file, please add snippet first");
			key = await vscode.window.showInputBox({placeHolder: "snippet key"});
		} else {
			key = await vscode.window
				.showQuickPick(parent.children, {placeHolder: "select snippet"})
				.then((x) => x && x.label);
		}
		if (!key) return;
		this.tree.reveal({filepath: parent.filepath, label: key});
		this.editSnippet({filepath: parent.filepath, key});
	}

	getTreeItem(e) {
		if (e.contextValue) return e;
		let item = this.findGroup(e.filepath);
		if (!item) return;
		return item.children.find((x) => x.label == (e.label || e.key));
	}

	getChildren(element) {
		if (!element) {
			return this.data;
		}
		return element.children;
	}

	getParent(e) {
		if (e.contextValue) return e.parent;
		let item = this.getTreeItem(e);
		if (item) return item.parent;
	}

	findGroup(filepath) {
		let item = this.data.find((item) => item.filepath == filepath);
		if (!item) this.openFile(filepath);
		item = this.data.find((item) => item.filepath == filepath);
		return item;
	}

	pickGroup() {
		return vscode.window.showQuickPick(this.data, {
			placeHolder: this.data.length
				? "select snippet file"
				: "no scope snippet file found, please create first",
		});
	}

	async pickSnippet(item) {
		item = item || (await this.pickGroup());
		if (!item) return;
		return vscode.window.showQuickPick(item.children, {
			placeHolder: item.children.length
				? "select snippet"
				: "no snippet in this file, please add snippet first",
		});
	}

	async addGroup() {
		let name = await vscode.window.showInputBox({placeHolder: "snippet file name"});
		if (!name) return;
		let fs = vscode.workspace.fs;
		let rootDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
		await fs.createDirectory(vscode.Uri.file(path.join(rootDir, ".vscode")));
		let filepath = path.join(rootDir, ".vscode", name + ".code-snippets");
		this.addSnippet({filepath});
	}

	/**
	 * @param {{filepath:string;key:string;scope?:string;body?:string;}} item
	 */
	async addSnippet(item) {
		if (!item) {
			// call from command
			item = await this.pickGroup();
			if (!item) return;
		}

		let body = item.body;
		if (!body) {
			let text = utils.getSelectedText();
			if (text) body = text.replace(/\$/g, "\\$");
		}

		let scope = utils.getCurrentLanguage();
		if ("javascript,typescript,javascriptreact,typescriptreact".includes(scope)) {
			scope = "javascript,typescript,javascriptreact,typescriptreact";
		}
		if (scope == "vue") {
			scope = "vue,vue-html";
		}
		let key = item.key || (await vscode.window.showInputBox({placeHolder: "snippet key"}));
		if (key) {
			this.editSnippet({filepath: item.filepath, key, scope, body});
		}
	}

	async editGroup(item) {
		if (!item) {
			// call from command
			item = await this.pickGroup();
			if (!item) return;
		}
		vscode.window.showTextDocument(vscode.Uri.file(item.filepath));
	}

	async deleteGroup(item) {
		if (!item) {
			// call from command
			item = await this.pickGroup();
			if (!item) return;
		}
		if (!(await utils.confirm("Are you sure? delete snippet file: " + item.filepath))) return;
		fs.unlinkSync(item.filepath);
		this.data = this.data.filter((x) => x.filepath != item.filepath);
		this._onDidChangeTreeData.fire();
	}

	async deleteSnippet(e, isForce) {
		console.log("deleteSnippet0", e);
		if (e && !e.parent) e = this.getTreeItem(e);
		console.log("deleteSnippet1", e);
		if (!e) {
			// call from command
			e = await this.pickSnippet();
			if (!e) return;
		}
		if (!e.parent || !e.parent.filepath)
			return vscode.window.showErrorMessage(`snippet file not found: [${e.label}]`);
		let item = this.findGroup(e.parent.filepath);
		if (!item) return vscode.window.showErrorMessage(`snippet file not found: ${e.filepath}`);
		if (!item.data[e.label])
			return vscode.window.showErrorMessage(`snippet "${e.label}" not found in ${e.filepath}`);
		if (!isForce && !(await utils.confirm("Are you sure? delete snippet: " + e.label))) return;
		delete item.data[e.label];
		item.children = item.children.filter((x) => x.label != e.label);
		let content = cjson.stringify(item.data, null, 2);
		fs.writeFileSync(e.parent.filepath, content, "utf8");
		e.parent.text = content;
		this._onDidChangeTreeData.fire();
	}

	async renameSnippet(e) {
		if (!e) {
			// call from command
			e = await this.pickSnippet();
			if (!e) return;
		}
		if (!e.parent || !e.parent.filepath)
			return vscode.window.showErrorMessage(`snippet file not found: [${e.label}]`);
		let item = this.findGroup(e.parent.filepath);
		if (!item) return vscode.window.showErrorMessage(`snippet file not found: ${e.filepath}`);
		if (!item.data[e.label])
			return vscode.window.showErrorMessage(`snippet "${e.label}" not found in ${e.filepath}`);
		let name = await vscode.window.showInputBox({placeHolder: "rename snippet"});
		if (!name) return;
		if (name == e.label) return;
		if (item.data[name]) {
			if (!(await utils.confirm("Are you sure? overwrite snippet: " + name))) return;
			item.children = item.children.filter((x) => x.label != name);
		}
		item.data[name] = item.data[e.label];
		delete item.data[e.label];
		let child = item.children.find((x) => x.label == e.label);
		if (child) {
			child.label = name;
			child.command.arguments[0].key = name;
		}
		let content = cjson.stringify(item.data, null, 2);
		fs.writeFileSync(e.parent.filepath, content, "utf8");
		e.parent.text = content;
		this._onDidChangeTreeData.fire();
		this.editSnippet({filepath: e.parent.filepath, key: name});
	}

	/**
	 * @param {{filepath:string;key:string;scope?:string;body?:string;}} e
	 */
	async editSnippet(e) {
		if (!e) {
			// call from command
			e = await this.pickSnippet();
			if (!e) return;
			e = {filepath: e.parent.filepath, key: e.label};
		}
		let item = this.findGroup(e.filepath);
		if (!item) return vscode.window.showErrorMessage(`snippet file not found: ${e.filepath}`);
		let snippet = {...item.data[e.key], ...e};
		let languageId = "javascript";
		if (snippet.scope) languageId = snippet.scope.split(",")[0];
		if (!snippet.prefix) snippet.prefix = e.key;
		let text = utils.snippet2text(snippet, languageId);

		let filename = path.join(
			os.tmpdir(),
			utils.md5(e.filepath + e.key).slice(0, 8) + "." + languageId + ".scopesnippet"
		);
		// let filename = path.join(os.tmpdir(), languageId + ".scopesnippet");
		let content;
		if (!fs.existsSync(filename)) fs.writeFileSync(filename, (content = text));
		let editor = await vscode.window.showTextDocument(vscode.Uri.file(filename));
		await vscode.languages.setTextDocumentLanguage(editor.document, languageId).catch(() => {});
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
	saveSnippet(snippet, isDrog) {
		let {filepath, key, ...rest} = snippet;
		if (!filepath) {
			vscode.window.showErrorMessage("@filepath is required");
			return;
		}
		if (!key) {
			vscode.window.showErrorMessage("@key is required");
			return;
		}
		if (!snippet.prefix) {
			vscode.window.showErrorMessage("@prefix is required");
			return;
		}
		if (!snippet.body || !snippet.body.length) {
			vscode.window.showErrorMessage("snippet body can't be empty");
			return;
		}
		let item = this.findGroup(filepath);
		let data = item ? item.data : {};
		if (data[key]) Object.assign(data[key], rest);
		else data[key] = rest;
		if (!data[key].description) delete data[key].description;
		let content = cjson.stringify(data, null, 2);
		fs.writeFileSync(filepath, content, "utf8");
		item.text = content;
		if (!isDrog) vscode.window.showInformationMessage(`scope snippet "${key}" save success`);
		if (item) {
			let child = item.children.find((x) => x.label == key);
			if (child) {
				child.description = snippet.description;
			} else {
				child = {
					label: key,
					parent: item,
					contextValue: "snippet",
					description: snippet.description,
					command: {
						command: "snippetScopeExplorer.editSnippet",
						arguments: [{filepath, key}],
						title: "Edit Snippet.",
					},
				};
				item.children.push(child);
				item.children.sort((a, b) => (a.label > b.label ? 1 : -1));
			}
			this._onDidChangeTreeData.fire();
		} else {
			this.openFile(filepath, content);
		}
		this.tree.reveal({filepath, label: key});
		return true;
	}
}

module.exports = SnippetScopeNodeProvider;
