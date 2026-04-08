# LockBrowser

学習問題に答えないと一時的にブラウズを再開できない Chrome Extension MVP です。
Chrome Extension 自体よりも、学習エンジンとロック解除 UX を育てるための実験プロジェクトとして作っています。

## 現在の機能

- 全ページにロック overlay を表示
- 文字を 1 文字ずつ選ぶクイズ回答 UI
- 正解後に確認画面を挟んでロック解除
- 不正解時の 10 秒ペナルティ
- `chrome.storage.local` ベースの問題リスト、進捗、出題状態の保存
- overdue / upcoming / unseen / future を使った優先度ベースの出題

## 使い方

1. `chrome://extensions/` を開く
2. デベロッパーモードを有効化する
3. 「パッケージ化されていない拡張機能を読み込む」でこのフォルダを選ぶ
4. 任意の通常 Web ページを開く
5. 問題に正解し、`ロックを解除` ボタンで一時解除する

## 現在の構成

- `background/`: service worker の本体
- `logic/`: 出題選択、進捗更新、ロック状態計算
- `storage/`: `chrome.storage.local` の薄いラッパ
- `data/`: 初期問題リストと初期問題
- `content/`: overlay 表示と回答 UX
- `ui/`: 管理画面の土台

## 今後の予定

- options 画面からのリスト有効 / 無効切り替え
- JSON / TSV / Anki 形式のインポート
- 複数問題リスト対応
- pause / resume 時の `reviewAt` シフト
- クラウド同期とアカウント連携

## 開発メモ

- ビルドツールなしのプレーン JavaScript
- service worker は `background/background.js`
- options 画面は `ui/options.html`
- 進捗は `progressByKey[listId:questionId]` 形式で保存
- 出題ロジックは `logic/question-selector.js` に寄せてあります
