# LockBrowser

学習問題に答えるまで一定時間ブラウザ操作を制限する、Chrome Extension のプロトタイプです。  
いまの実装は、ロック解除 UX と学習エンジンを小さく試しながら育てるための MVP です。

## 現在できること

- Web ページ上にロック overlay を表示
- 問題に正解するとロック解除
- `keyboard` / `candidate` / `multiple-choice` の 3 つの回答方式に対応
- 初見問題と既習問題で不正解時の扱いを分離
- 問題リストごとの有効 / 一時停止
- dashboard で item / card ベースの問題編集
- 新形式 JSON の import / export
- `chrome.storage.local` ベースの進捗保存

## データモデル

問題データは v2 スキーマに統一しています。

```json
{
  "version": 2,
  "lists": [
    {
      "id": "list-en-basic",
      "title": "English Basics",
      "description": "",
      "enabled": true,
      "pausedAt": null,
      "items": [
        {
          "id": "item-001",
          "fields": {
            "front": [{ "type": "text", "value": "apple" }],
            "back": [{ "type": "text", "value": "りんご" }],
            "reading": [{ "type": "text", "value": "りんご" }],
            "explanation": [{ "type": "text", "value": "Basic fruit vocabulary." }]
          },
          "cards": [
            {
              "id": "item-001-card-001",
              "template": "front-to-back",
              "input": { "mode": "keyboard" },
              "answer": {
                "type": "text",
                "accepted": ["りんご"],
                "correctChoiceIds": []
              },
              "choices": []
            }
          ],
          "tags": []
        }
      ]
    }
  ]
}
```

### 主要な概念

- `list`: 問題リスト
- `item`: 素材単位の問題本体
- `card`: 1 item をどう出題するかの定義
- `parts`: `text / image / audio` の表示パーツ
- `answer`: `text` または `choice` の判定定義

## 進捗管理

進捗は card 単位で保存します。

- `progressByKey[listId:cardId]`

ランクの扱いは次の 4 区分です。

- `未着手`: `isUnseen === true`
- `学習中`: `level 1-3`
- `復習`: `level 4-19`
- `定着`: `level 20+`

## 画面構成

- `popup/`
  - 現在のロック状態確認
  - 一時停止 / 再開
  - 問題管理 / 設定への導線
- `dashboard/`
  - 問題リスト一覧
  - item / card 編集
  - import / export
- `ui/options.html`
  - ロック間隔
  - 問題数
  - 回答方式
  - 除外サイト
  - その他の設定
- `content/`
  - Web ページ上のロック overlay

## ディレクトリ概要

- `background/`: service worker 本体
- `content/`: overlay 描画と回答 UI
- `dashboard/`: 問題管理画面
- `popup/`: クイック操作 UI
- `ui/`: options 画面
- `logic/`: schema / selector / progress / resolved card
- `storage/`: `chrome.storage.local` ラッパ
- `data/`: 初期データ

## 開発メモ

- ビルドツールなしのプレーン JavaScript
- Manifest V3
- service worker は [background/background.js](C:/Users/irami/dev/lockBrowser/background/background.js)
- スキーマ定義は [logic/schema.js](C:/Users/irami/dev/lockBrowser/logic/schema.js)
- resolved card 生成は [logic/resolved-card.js](C:/Users/irami/dev/lockBrowser/logic/resolved-card.js)
- storage の source of truth は [storage/storage.js](C:/Users/irami/dev/lockBrowser/storage/storage.js)

## 今後の予定

- image / audio を含む dashboard プレビュー改善
- multiple-choice 編集 UI の強化
- importers の分離
  - native JSON
  - CSV / TSV
  - Anki 変換
- card 複数編集の並び替え / 削除 UX 改善
- media 管理と export 強化
