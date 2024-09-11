const vscode = require("vscode");
const path = require("path");
const SnippetNodeProvider = require("./src/SnippetNodeProvider");
const SnippetScopeNodeProvider = require("./src/SnippetScopeNodeProvider");
const DragAndDropController = require("./src/DragAndDropController");
const utils = require("./common/utils");

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	let provider = new SnippetNodeProvider();
	let explorer = vscode.window.createTreeView("snippetExplorer", {
		treeDataProvider: provider,
		dragAndDropController: new DragAndDropController(provider),
		showCollapseAll: true,
	});
	provider.tree = explorer;
	let scope_provider = new SnippetScopeNodeProvider();
	let scope_explorer = vscode.window.createTreeView("snippetScopeExplorer", {
		treeDataProvider: scope_provider,
		dragAndDropController: new DragAndDropController(scope_provider),
		showCollapseAll: true,
	});
	scope_provider.tree = scope_explorer;
	setTimeout(() => {
		scope_provider.refresh();
	});
	context.subscriptions.push(
		...[
			"refresh",
			"search",
			"addGroup",
			"addSnippet",
			"editGroup",
			"deleteGroup",
			"deleteSnippet",
			"renameSnippet",
			"editSnippet",
		]
			.map((key) => {
				return [
					vscode.commands.registerCommand(`snippetExplorer.${key}`, provider[key].bind(provider)),
					vscode.commands.registerCommand(
						`snippetScopeExplorer.${key}`,
						scope_provider[key].bind(scope_provider)
					),
				];
			})
			.flat(),
		vscode.commands.registerCommand("snippetExplorer.open", function () {
			explorer.reveal(provider.getChildren()[0]);
		}),
		vscode.commands.registerCommand("easySnippet.run", async function () {
			if (scope_provider.data.length) {
				let items = [{label: "vscode snippet"}].concat(scope_provider.data);
				let item = await vscode.window.showQuickPick(items, {placeHolder: "select snippet scope"});
				if (!item) return;
				if (item.filepath) {
					scope_provider.addSnippet(item);
					return;
				}
			}
			let label = utils.getCurrentLanguage();
			provider.addSnippet({label});
		}),
		vscode.workspace.onDidSaveTextDocument(function (e) {
			if (
				e.fileName.endsWith(".json") &&
				e.fileName.toLowerCase().startsWith(utils.getVsCodeSnippetsPath().toLowerCase())
			)
				return provider.refresh();
			if (e.fileName.endsWith(".code-snippets"))
				return scope_provider.openFile(e.fileName, e.getText());
			if (e.fileName.endsWith(".snippet")) {
				let name = path.basename(e.fileName, ".snippet");
				let ss = name.split(".");
				if (ss.length != 2) return;
				let key = Buffer.from(ss[0].replace(/-/g, "/"), "base64").toString();
				let languageId = ss[1];
				let snippet = utils.text2snippet(e.getText(), languageId);
				provider.saveSnippet({...snippet, languageId, key});
				provider.refresh();
			}
			if (e.fileName.endsWith(".scopesnippet")) {
				let name = path.basename(e.fileName, ".scopesnippet");
				let languageId = name.split(".").pop();
				let snippet = utils.text2snippet(e.getText(), languageId);
				scope_provider.saveSnippet(snippet);
			}
		}),
		vscode.window.onDidChangeActiveTextEditor(function (e) {
			if (!e) return;
			let doc = e.document;
			scope_provider.openFile(doc.fileName, doc.getText());
		})
	);
}
exports.activate = activate;

function deactivate() {
	utils.clearCaches();
}
exports.deactivate = deactivate;
