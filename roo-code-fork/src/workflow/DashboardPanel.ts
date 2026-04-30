import * as vscode from "vscode"

/**
 * WorkflowDashboardPanel
 * 
 * Manages the VS Code Webview panel for the Workflow Command Center.
 * The Webview contains an iframe pointing to the local WorkflowBridge server.
 */
export class WorkflowDashboardPanel {
    public static currentPanel: WorkflowDashboardPanel | undefined
    private static readonly viewType = "rooWorkflowDashboard"

    private readonly _panel: vscode.WebviewPanel
    private _disposables: vscode.Disposable[] = []

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined

        // If we already have a panel, show it.
        if (WorkflowDashboardPanel.currentPanel) {
            WorkflowDashboardPanel.currentPanel._panel.reveal(column)
            return
        }

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            WorkflowDashboardPanel.viewType,
            "Workflow Command Center",
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        )

        WorkflowDashboardPanel.currentPanel = new WorkflowDashboardPanel(panel, extensionUri)
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel

        // Set the webview's initial html content
        this._update()

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programmatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables)

        // Update the content based on view state changes
        this._panel.onDidChangeViewState(
            (e) => {
                if (this._panel.visible) {
                    this._update()
                }
            },
            null,
            this._disposables
        )
    }

    public dispose() {
        WorkflowDashboardPanel.currentPanel = undefined

        // Clean up our resources
        this._panel.dispose()

        while (this._disposables.length) {
            const x = this._disposables.pop()
            if (x) {
                x.dispose()
            }
        }
    }

    private _update() {
        this._panel.webview.html = this._getHtmlForWebview()
    }

    private _getHtmlForWebview() {
        // The dashboard is served by the WorkflowBridge on port 3001.
        // We use an iframe to embed it, which allows it to function 
        // exactly like a standalone browser tab.
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Workflow Command Center</title>
    <style>
        body, html { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; background: #0f172a; }
        iframe { border: none; width: 100%; height: 100%; }
        .loading { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #6366f1; font-family: sans-serif; }
    </style>
</head>
<body>
    <div class="loading">Connecting to Workflow Bridge...</div>
    <iframe src="http://127.0.0.1:3001/" onload="document.querySelector('.loading').style.display='none'"></iframe>
    <script>
        // Refresh iframe if it fails to load (server might be starting)
        const iframe = document.querySelector('iframe');
        let attempts = 0;
        const checkLoad = setInterval(() => {
            try {
                if (iframe.contentWindow.location.href === 'about:blank' && attempts < 10) {
                    iframe.src = iframe.src;
                    attempts++;
                } else {
                    clearInterval(checkLoad);
                }
            } catch(e) { clearInterval(checkLoad); }
        }, 2000);
    </script>
</body>
</html>`
    }
}
