const vscode = require('vscode');

function activate(context) {
    let disposable = vscode.commands.registerCommand('easySnippet.run', function() {
        let editer = vscode.window.activeTextEditor
        let content = editer.document.getText(editer.selection)
        let snippet = {
            "${1:snippet name}": {
                prefix: "${2:$1}",
                body: content.split("\n"),
                description: "${3:$1}"
            }
        }
        let s = JSON.stringify(snippet, null, 4)
        editer.insertSnippet(new vscode.SnippetString(s), editer.selection)
    });

    context.subscriptions.push(disposable);
}
exports.activate = activate;

function deactivate() {}
exports.deactivate = deactivate;