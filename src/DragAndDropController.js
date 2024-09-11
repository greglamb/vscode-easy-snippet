const vscode = require("vscode");

class DragAndDropController {
	constructor(tree) {
		this.dropMimeTypes = ["text/easy-snippet"];
		this.dragMimeTypes = ["text/easy-snippet"];
		this.tree = tree;
	}

	async handleDrop(target, sources, token) {
		let transferItem = sources.get("text/easy-snippet");
		let data = transferItem && transferItem.value;
		if (!data) return;
		try {
			if (typeof data === "string") data = JSON.parse(data);
		} catch (error) {
			return;
		}
		console.log("handleDrop", data);
		if (await this.tree.onDrop(target, data)) {
			if (data.type) {
				return vscode.commands.executeCommand(data.type + ".deleteSnippet", data, true);
			}
		}
	}

	handleDrag(nodes, treeDataTransfer, token) {
		let node = nodes[0];
		if (!node) return;
		let data = this.tree.getDragData(node);
		if (!data) return;
		console.log("handleDrag", data);
		treeDataTransfer.set("text/easy-snippet", new vscode.DataTransferItem(data));
	}
}
module.exports = DragAndDropController;
