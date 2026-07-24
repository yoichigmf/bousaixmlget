# 作業記録: 気象庁防災情報XML取得 → SpreadSheet書き込み

## 日付
2026-07-16

## 背景・要件

Google Apps Script (GAS) プロジェクト（clasp管理）に、気象庁の防災情報XMLを取得してSpreadSheetに書き込む関数を新規作成する依頼。

ヒアリングにより以下の方針を確定：

- **取得元**: 気象庁「高頻度フィード」（Atom形式の一覧フィード）から自動取得
  - `extra.xml`（気象警報・注意報等）
  - `eqvol.xml`（地震・津波・火山情報等）
  - 上記両方を対象とする
- **書き込み内容**: XMLをパースし、主要項目を列ごとにSpreadSheetへ書き込む
- **書き込み先**: このGASプロジェクトに紐づくコンテナースプレッドシート（`SpreadsheetApp.getActiveSpreadsheet()`）

## 調査内容

### フィード構造（Atom形式）

`https://www.data.jma.go.jp/developer/xml/feed/extra.xml` および `eqvol.xml` を実際に取得して構造を確認。

```xml
<feed xmlns="http://www.w3.org/2005/Atom" lang="ja">
  <entry>
    <title>気象警報・注意報（Ｈ２７）</title>
    <id>https://www.data.jma.go.jp/developer/xml/data/20260715192952_0_VPWW54_180000.xml</id>
    <updated>2026-07-15T19:29:51Z</updated>
    <author><name>福井地方気象台</name></author>
    <link type="application/xml" href="https://www.data.jma.go.jp/developer/xml/data/....xml"/>
    <content type="text">【福井県気象警報・注意報】注意報を解除します。</content>
  </entry>
  ...
</feed>
```

- `entry/id` が個別データXMLのURLと一致（重複チェックのキーに利用可能）
- `entry/link/@href` から個別データXMLを取得できる

### 個別データXML（JMAXML）構造

サンプル（VPWW54: 気象警報・注意報）を取得して構造を確認。

```xml
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/" ...>
  <Control>
    <Title>気象警報・注意報（Ｈ２７）</Title>
    <DateTime>2026-07-15T19:29:51Z</DateTime>
    <Status>通常</Status>
    <EditorialOffice>福井地方気象台</EditorialOffice>
    <PublishingOffice>福井地方気象台</PublishingOffice>
  </Control>
  <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
    <Title>福井県気象警報・注意報</Title>
    <ReportDateTime>2026-07-16T04:29:00+09:00</ReportDateTime>
    <InfoType>発表</InfoType>
    <InfoKind>気象警報・注意報</InfoKind>
    <Headline>
      <Text>注意報を解除します。</Text>
      <Information type="...">
        <Item><Kind><Name>解除</Name>...</Kind><Areas>...(細分区域まで多階層)...</Areas></Item>
      </Information>
    </Headline>
  </Head>
</Report>
```

- `Control` と `Head` は別々の名前空間を持つ
- `Head/Headline/Information/Item/Areas/Area` は対象地域が多数・多階層になり得るため、行が爆発しないよう **フィードentry単位で1行** にまとめる方針とした（Areaごとの展開はしない）

## 実装内容（`getxml.js`）

### メイン関数
`fetchJmaXmlToSpreadsheet()`

### 処理フロー
1. `extra.xml` / `eqvol.xml` の各フィードをAtomとして取得・パース
2. 各 `entry` の `id`（= 個別データXMLのURL）をキーに、書き込み先シートの既存IDと照合し重複を除外
3. 未取得のentryについて、`link/@href` から個別データXML（JMAXML）を取得
4. `Control`（発表官署・発表日時・タイトル・ステータス）と `Head`（発表時刻・情報種別・情報分類・見出しText）を抽出
5. コンテナースプレッドシートの「気象庁防災情報」シート（存在しなければ自動作成、ヘッダー行付き）に新規行として追記

### 書き込み列（ヘッダー）
| フィード | entryID | 発表時刻(entry) | フィードタイトル | 発表官署(author) | 概要(content) | Controlタイトル | Control発表日時 | ステータス | 発表官署(Control) | 発表時刻(Head) | 情報種別(InfoType) | 情報分類(InfoKind) | 見出し |

### 主な補助関数
- `getOrCreateJmaSheet_()`: 書き込み先シートの取得/作成
- `getExistingEntryIds_()`: 重複チェック用に既存entryID（B列）を取得
- `fetchFeedEntries_()`: Atomフィードをパースしentry一覧を抽出
- `fetchEntryDetail_()`: 個別データXML(JMAXML)を取得しControl/Headの主要項目を抽出
- `getHeadElement_()`: `Head`要素が独自の名前空間を持つため、名前を指定して子要素を走査して取得
- `getChildText_()`: 子要素のテキストを安全に取得（存在しない場合は空文字）

## 動作確認・反映

- `node --check` によるJS構文チェック: OK
- `npx clasp push` を実行し、GASプロジェクトへ反映済み
  ```
  Pushed 2 files at 4:34:59.
  └─ appsscript.json
  └─ getxml.js
  ```

## 次のステップ（未実施・要望があれば対応）

- GASエディタで `fetchJmaXmlToSpreadsheet` を手動実行して動作確認
- 定期実行が必要な場合は時間主導型トリガーの設定
- 必要であればArea単位での詳細展開への変更

---

## 追記: 2026-07-24 GAS↔ローカル同期 と gitリポジトリ化

### clasp pull
- GASエディタ側で追加されていた以下の関数をローカルに取り込むため `clasp pull` を実施
  - `TestPost()`: Slack投稿のテスト関数
  - `PostSlack(msg)`: スクリプトプロパティ `SLACK_WEBHOOK_URL` を使ってSlack Webhookに投稿する関数
- pull前に `backup/getxml_20260724_145142.js` 等としてタイムスタンプ付きバックアップを作成してから実施（差分消失を防ぐため）

### gitリポジトリ化
- `git init` でローカルリポジトリを作成
- `.gitignore` を作成（`backup/`, `node_modules/` を除外）
- 初回コミット（`970f517`）: `.clasp.json` / `.gitignore` / `WORK_LOG.md` / `appsscript.json` / `getxml.js` を追加
- リモート `origin` を `https://github.com/yoichigmf/bousaixmlget.git` に設定
- `git push -u origin master` でGitHubへ初回push

## 追記: 2026-07-24 台風情報・津波情報の追加対応

### 調査
- 気象庁XMLフォーマット公式ページ（`https://xml.kishou.go.jp/`）および電文一覧PDF（`xml.kishou.go.jp/xmllist.pdf`）を確認
- atomフィードの分類は次の4種類:
  - 定時（`regular.xml`）: 天気概況など定時発表
  - 随時（`extra.xml`）: 警報・注意報や**台風情報**など随時発表
  - 地震火山（`eqvol.xml`）: 地震・**津波情報**・火山に関する情報
  - その他（`other.xml`）: 上記以外
- **結論**: 台風情報は `extra.xml`、津波情報は `eqvol.xml` に既に含まれており、フィードURLの追加は不要。既存実装でも取得自体はできていた

### 実装内容（`getxml.js` 追加分）
- Controlタイトルを気象庁電文一覧の資料名に基づくキーワードで判定し、該当する電文を専用シートにも追記するよう変更
  - 台風判定キーワード: `台風情報` `台風解析・予報情報` `台風の暴風域に入る確率` `発達する熱帯低気圧に関する情報`
  - 津波判定キーワード: `津波警報` `津波注意報` `津波予報` `津波情報` `沖合の津波観測に関する情報` `南海トラフ地震臨時情報` `南海トラフ地震関連解説情報`
- 追加シート: 「台風情報」「津波情報」（既存の「気象庁防災情報」シートとは別に、条件一致した電文のみ重複して追記）
- 追加関数: `isTyphoonTitle_()` / `isTsunamiTitle_()` / `matchesAnyKeyword_()` / `appendRows_()`
- `getOrCreateJmaSheet_()` をシート名引数化し、3シート（通常/台風/津波）で使い回せるよう変更
- 各シートで `entryID` ベースの重複チェックを独立して実施

### clasp push時のトラブルと対応
- `.claspignore` が存在しなかったため、初回push時に `backup/` 配下のファイルも誤ってGASプロジェクトにpushされた
- `.claspignore` を新規作成し、`appsscript.json` と `getxml.js` のみを対象にするよう設定
- 誤pushされた `backup/getxml_20260724_145142.js` はclaspのpushだけでは削除できないため、GASエディタ側の手動削除をユーザーに依頼（本作業ログ時点では未削除の可能性あり）

### 動作確認・反映
- `node --check` によるJS構文チェック: OK
- `npx clasp push` でGASプロジェクトへ反映
- git: `676e822`「台風情報・津波情報を別シートに振り分ける機能を追加」としてコミットし、`git push origin master` でGitHub（`yoichigmf/bousaixmlget`）へ反映

## 次のステップ（未実施・要望があれば対応）

- GASエディタ上に残っている誤pushファイル（`backup/getxml_...`）の削除確認
- `fetchJmaXmlToSpreadsheet` の定期実行トリガー設定
- 台風・津波の電文検知時にSlack通知（`PostSlack`）と連携するかどうかの検討
- Area単位での詳細展開が必要になった場合の設計変更
