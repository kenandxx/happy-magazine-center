# Happy Magazine Center

日本のアイドル専門誌・グラビアムック・週刊誌＆青年コミック誌（ポスター／クリアファイル／DVD付録あり）・アイドル表紙の女性誌・写真集・**2027年カレンダー**・**🔞 アダルト・R18**の**発売日（今月〜3ヶ月先）**、**関連写真（表紙・限定表紙・特典絵柄・公式先行カット）**、**ストア別限定特典（セブンネット / 楽天ブックス / HMV&BOOKS / TSUTAYA / Amazon）**、**公式SNS＆カバーガール宣伝ポスト**をスマホからワンタップでチェックできるモバイルファースト情報センターです。

- 🌐 **スマホ公開URL（GitHub Pages）**：https://kenandxx.github.io/happy-magazine-center/

## 主な機能（v1.0）

- **📲 スマホ共有シート「Amazon画面 → 1タップ即自動取込＆早め予約スコア判定」（`?import=` / PWA Web Share Target）**：Amazonを見ている画面から **iPhoneショートカット（「共有 → MagCenterへ送る」）・Android PWA共有メニュー・Safari/PCブックマークレット・クリップボード1タップ貼付** だけで Happy Magazine Center が起動し、openBDから **公式書影・発売日・定価** を取得＆その場で **売り切れ警戒スコア（S/A/B）をライブ判定** して即投入できます（短縮URL `amzn.asia` 共有時も既収録チェック＆メモ自動入力フォールバック対応）。
- **🤖 15出版社 PR TIMES 公式RSS ＋ 楽天ブックスAPI 毎朝07:00自動収集（`🆕 自動発見` バッジ付き）**：主要15出版社のPR TIMES RSS（ログイン不要・稼働中）に加え、無料の楽天アプリID（`RAKUTEN_APP_ID`）をGitHub Secretsに1つ登録するだけで **16主要誌・写真集・グラビア・🔞R18・2027カレンダー・楽天ブックス限定特典** を毎朝自動収集する専用エンジン（`scripts/rakuten-ingestor.mjs`）とアプリ内稼働ステータス／3ステップ設定ガイドを搭載。
- **📚 実在127作品・262オファー・検証済み書影187枚（うち `🔞 R18` 39作品・`🆕 自動発見` 20作品）**：松井珠理奈 2nd写真集『アイヲシル』（Amazon直リンク `/dp/4299065921` 検証済）、兒玉遥 3rd写真集『You will see』、高崎かなみ 3rd写真集、芳根京子 2027カレンダーなど最新20作品を追加収録。全187枚の画像をライブHTTP200・ISBN-10チェックサムまで自動検証。
- **💖 推しコーナー＆1タップ人気タレント登録（80名超）＋👑 マイVIP超人気枠 (+30pt)＋🚀 3段階推し加点ブースト**：ボトムナビ「💖 推し・棚」からアイドル・グラビア・R18女優をタップするだけで推し登録＆VIP昇格。「💖 推しのみ」「🆕 自動発見」トグルで一覧を瞬時絞り込み可能。
- **🔥「早め予約・争奪戦レーダー」(`#tab-urgent`)**：直近〜今後2〜3ヶ月（-14日〜+100日）を透明な7要素スコアリング（`src/scarcity-score.js`）で **🔴 Sランク（即予約推奨）・🟠 Aランク（早め確保）・🟡 Bランク（注目枠）** に自動判定。
- **👈 左手ワンハンド最適化・🏷 表紙・特典別マーク棚・🛡️ 書影＆ISBN整合性ガード・💰 月別予算メーター・📅 一括 `.ics` 出力・💾 JSONバックアップ復元・🚃 R18電車モード・🏪 ノイズゼロ表示（非Amazon無特典 0件）**

## 楽天ブックスAPI自動収集の有効化（無料・任意）

アプリ内の **「💖 推し・棚 → ⚡ 取込・保存」** にスマホ完結3ステップガイドを搭載しています。GitHubリポジトリの **Settings → Secrets and variables → Actions** に無料アプリIDを `RAKUTEN_APP_ID` として登録し、Actionsワークフローを実行すると即座に有効化されます（未設定でも15出版社PR TIMES＋openBDが完全動作）。

## 構成

- `index.html` / `manifest.json`（Web Share Target対応）/ `assets/icon.svg`：モバイルファースト・5タブナビ・PWA対応エントリーポイント
- `styles/main.css`：エディトリアル調 Vanilla CSS デザインシステム（左手親指操作対応・2列写真グリッド・早め予約レーダー・共有着信バナー・openBD自動取込＆セットアップカード・R18電車モードぼかし）
- `src/app.js` / `src/scarcity-score.js` / `src/isbn-lookup.js` / `src/cover-art.js` / `src/store-links.js` / `src/social-links.js`：ダッシュボードUI・売り切れ警戒スコアリング・`?import=`／共有シート／openBDライブ照会・版別棚管理・5ストア検索URL・公式SNSリンク・単体＆一括 `.ics` 生成
- `data/catalog.json`：2025年9月〜2027年2月の実在 **127作品**（うち `🔞 R18` **39作品**・`🆕 自動発見` **20作品**）・**262オファー**（非Amazon無特典 0件）・実機検証済み画像187枚
- `scripts/prtimes-ingestor.mjs`：15出版社PR TIMES RSS精密フィルタ＆記事HTMLメタデータ／限定特典抽出エンジン
- `scripts/rakuten-ingestor.mjs`：楽天ブックスAPI（16主要誌・写真集・グラビア・R18・2027カレンダー・限定特典）自動収集＆ノイズゼロ生成エンジン
- `scripts/normalizer.mjs`：複数ストア表記揺れの同一号グルーピング・特典種別抽出・非Amazon無特典除外フィルター
- `scripts/validate-catalog.mjs`：ストアポリシー・画像整合性・ISBN-10チェックサム・HMV NO-IMAGE／403／404検出バリデータ
- `scripts/fetch-catalog.mjs`：毎朝自動更新パイプライン（15出版社PR TIMES＋任意Rakuten Books API＋GitHub Actionsサマリー出力）
- `.github/workflows/daily-catalog-update.yml`：毎朝07:00 JST自動更新＋手動実行（`workflow_dispatch`）ワークフロー

## 検証コマンド

```bash
# 正規化・特典抽出・openBD/共有シート解析・PR TIMES・楽天API・カタログ整合性の単体テスト
npm test

# カタログのポリシー・ISBN-10・書影整合性チェック（URLライブ疎通チェック付き）
npm run validate
npm run validate:urls

# 収集パイプラインのドライラン検証
npm run collect:dry
```