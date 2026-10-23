# Contributing / 貢献について

- Issue・Pull Request は歓迎します。大きな変更は先に Issue で相談してください。
- 送る前に: `cd ui; npm.cmd ci; npm.cmd test; npm.cmd run build`、そして `powershell -ExecutionPolicy Bypass -File .\build.ps1 -Release -NoRun` が通ること。
- API キー・個人のパス・メールアドレスなどをコミットしないでください。
- 送られた変更は MIT ライセンス（LICENSE）で公開されることに同意したものとします。

Issues and pull requests are welcome. Please run the UI tests and a Release build before sending, never commit secrets or personal paths, and note that contributions are licensed under MIT.