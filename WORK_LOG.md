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

## 追記: 2026-07-25 対象地域(Area)列の追加

### 方針確認
- Areaは1電文に複数・多階層（府県予報区／一次細分区域／市町村等）含まれるため、表示方法をヒアリング
  - 表示形式: **1行にカンマ区切りで列挙**（Areaごとに行分割はしない。既存の「1entry=1行」構造を維持）
  - 対象階層: **全階層を区別せず列挙**（府県〜市町村等をまとめて重複除去）

### 実装内容（`getxml.js`）
- `JMA_HEADER` に列 `対象地域(Area)` を追加（最終列）
- `collectAreaNames_(element)`: `Head`要素配下を再帰的に走査し、`Area/Name`のテキストを重複除去しつつ収集する関数を追加
- `fetchEntryDetail_()` の戻り値に `areas`（カンマ区切り文字列）を追加し、`collectAreaNames_(headEl).join(', ')` で生成
- 行データ生成箇所に `detail.areas` を追加

### 動作確認・反映
- `node --check` によるJS構文チェック: OK
- `npx clasp push` でGASプロジェクトへ反映（`.claspignore`により不要ファイルは含まれず）
- git: `afce65d`「Area(対象地域)をSpreadSheetの表示列に追加」としてコミットし、GitHubへpush

## 追記: 2026-07-26 台風情報・津波情報の別シート出力を削除

### 経緯
- 実際にデータ取得を実行したところ、GASの実行時間上限（6分）を超過してタイムアウトが発生
- 原因は台風・津波判定処理そのものではなく、entry毎に個別XMLを`UrlFetchApp.fetch`で逐次取得する構造にあるが、まずは処理を軽くするため台風・津波の別シート振り分け機能を撤去する方針とした

### 実装内容（`getxml.js`）
- `JMA_TYPHOON_SHEET_NAME` / `JMA_TSUNAMI_SHEET_NAME` と関連定数を削除
- `isTyphoonTitle_()` / `isTsunamiTitle_()` / `matchesAnyKeyword_()` を削除
- `fetchJmaXmlToSpreadsheet()` を「気象庁防災情報」シートへの書き込みのみに簡素化
- Area列（対象地域）の抽出・表示機能は維持

### 動作確認・反映
- `node --check` によるJS構文チェック: OK
- `npx clasp push` でGASプロジェクトへ反映
- git: `6637fe9`「台風情報・津波情報の別シート出力を削除」としてコミットし、GitHubへpush

### 既知の課題（未解消）
- 実行時間超過の根本原因である「entry毎の個別XML逐次取得」は未対応
- フィードのentry件数が多い（＝新規データが多い）タイミングで再度タイムアウトする可能性が残っている

## 追記: 2026-07-28 重大防災情報のSlack自動通知機能を追加

### 要件
以下に該当する電文を新規取得した際、Slackに内容を投稿する:
- 地震（震度5弱以上）
- 津波（警報・注意報）
- 気象の特別警報・警報
- 噴火（速報・警報）
- 避難指示などの避難情報

### 調査
- 気象庁XMLフォーマット技術資料ページ（`xml.kishou.go.jp/tec_material.html`）からサンプル電文一式（`jmaxml_20260723_Samples.zip`）を取得し、実データで判定に使う要素パスを確認
- **地震情報（震源・震度に関する情報／VXSE53）**: `Body/Intensity/Observation/MaxInt`が全国最大震度（`5-`=5弱, `5+`=5強, ... `7`）。`Head/InfoType`が「取消」の場合`Body`が出現しない点に注意
- **津波警報・注意報・予報（VTSE41等）**: `Control/Title`="津波警報・注意報・予報"、`Head/Headline/Information/Item/Kind/Name`に「大津波警報」「津波警報」「津波注意報」が入る
- **気象特別警報・警報・注意報（VPWW53等）**: `Kind/Name`は「大雨特別警報」「洪水警報」「大雨注意報」のように「現象名＋警報種別」の形式。末尾が「特別警報」または「警報」（「注意報」を除く）で判定
- **噴火警報・予報（VFVO50等）**: `Head/InfoKind`="噴火警報・予報"、`Kind/Name`に「噴火警報」「火口周辺警報」が入る。噴火速報は`Control/Title`に含まれる
- **避難指示等の避難情報**: 気象庁防災情報XML電文一覧には含まれない（市区町村がLalert等別経路で発令するため）。ヒアリングの結果、代替として気象庁が発令する「土砂災害警戒情報」を避難判断の目安として対象に含める方針とした

### 実装内容（`getxml.js`）
- `fetchEntryDetail_()` の戻り値に `kindNames`（Kind/Name一覧の配列）と `maxInt`（全国最大震度）を追加
- `collectKindNames_()`: Head配下のKind/Name要素を再帰収集
- `findMaxIntensity_()`: Body/Intensity/Observation/MaxIntを取得（震度速報など存在しない電文はエラーにせず空文字を返す）
- `getAlertReason_()`: 上記5種類の判定条件に一致するか判定し、該当理由の文字列を返す
- `isIntensity5WeakOrMore_()` / `formatIntensityLabel_()`: 震度コード（`5-`, `5+`等）の比較・表示ラベル変換
- `buildAlertMessage_()`: Slack投稿メッセージ本文を組み立て（種別・タイトル・見出し・発表時刻・発表官署・対象地域・電文URL）
- `fetchJmaXmlToSpreadsheet()` 内で、新規行判定と同じループで通知判定を行い、対象があれば最後にまとめて既存の `PostSlack()` を呼び出す（新規トリガーは追加不要）
- 重複通知防止は既存の `entryID` 重複チェックをそのまま流用

### 動作確認・反映
- `node --check` によるJS構文チェック: OK
- 震度コード比較・警報名末尾判定ロジックをNode.js上で単体検証（`5-`/`5+`は5弱以上と判定、`大雨特別警報`は該当・`大雨注意報`は非該当など、想定通りの結果を確認）
- `npx clasp push` でGASプロジェクトへ反映
- git: `659ffac`「重大な防災情報をSlackに自動通知する機能を追加」としてコミットし、GitHubへpush

### 既知の制約
- 避難指示・避難勧告などの市区町村発令情報そのものは対象外（気象庁XMLの配信範囲外）
- entry毎の個別XML逐次取得という処理構造は変わっていないため、実行時間超過のリスクは引き続き残る

## 次のステップ（未実施・要望があれば対応）

- `fetchJmaXmlToSpreadsheet` の定期実行トリガー設定
- ~~実行時間超過対策: 1回の実行で処理するentry件数の上限設定、または未処理分を次回に持ち越す仕組みの検討~~ → 2026-07-28 キュー方式で対応
- Area件数が非常に多い電文（府県全体の警報・注意報等）でセル文字数が肥大化しないかの実運用確認
- 実際に地震・津波・特別警報等が発生した際の本番動作確認（Slack投稿内容・整形の調整）

## 追記: 2026-07-28 実行時間超過対策（キュー方式による取得・処理フェーズ分割）

### 経緯
- 「entry毎の個別XML逐次取得」がGAS実行時間上限（6分）超過の根本原因として残っていた
- ユーザー提案: 「XML問い合わせ日時をキーとして問い合わせ結果をグループとして管理する」方式で対応することに

### 方針確定までのヒアリング
- 対策の方向性: **XML取得とシート書き込みを別フェーズに分割**し、取得実行日時ごとにキャッシュ（一時保存）して後で一括処理する方式を選択
- 一時保存先: CacheService（最大6時間・1件100KB制限あり）ではなく、**専用の一時シート「_queue」に行として保存**（件数・データ量の制約を受けにくいため）
- 後続処理のタイミング: 取得用（`enqueueJmaXmlEntries`）と処理用（`processJmaXmlQueue`）で**関数を分け、別々の時間主導型トリガーで実行**する構成を選択
- 既存の一括処理関数（`fetchJmaXmlToSpreadsheet`）は削除せず、手動テスト・少件数時の簡易実行用として残置

### 実装内容（`getxml.js`）
- `JMA_QUEUE_SHEET_NAME`（`_queue`）、`JMA_QUEUE_HEADER`（問い合わせ日時／フィード／entryID／発表時刻／フィードタイトル／発表官署／概要／dataUrl）を追加
- `JMA_QUEUE_BATCH_SIZE`（既定30件）、`JMA_QUEUE_TIME_LIMIT_MS`（4.5分。6分上限に対する安全マージン）を追加
- **`enqueueJmaXmlEntries()`**（取得フェーズ）: フィードから新規entryのみ検出し、個別XMLは取得せず`_queue`シートに追記するだけの軽量処理。全行共通の「問い合わせ日時」（`new Date()`を1回だけ生成）をグループキーとして持たせる。メインシートとキュー両方の既存entryIDと突き合わせて重複登録を防止
- **`processJmaXmlQueue()`**（処理フェーズ）: `_queue`シート先頭から`JMA_QUEUE_BATCH_SIZE`件、または経過時間が`JMA_QUEUE_TIME_LIMIT_MS`を超えるまでを処理。個別XML取得・メインシート書き込み・Slack通知判定を行い、処理済み行をキューから`deleteRows`で削除。未処理分はキューに残り次回実行で継続処理される
- `getOrCreateQueueSheet_()`: `_queue`シートの取得・作成（ヘッダー付き）
- `getExistingEntryIds_()`: 列番号を引数で指定できるよう拡張（キューのentryID列はC列＝3列目のため）

### 動作確認・反映
- `node --check` によるJS構文チェック: OK
- `npx clasp push` でGASプロジェクトへ反映
- git: `0f61406`「実行時間超過対策としてキュー方式の取得・処理フェーズ分割を追加」としてコミットし、GitHubへpush

### 運用上の注意（次のステップ）
- GASエディタ側でのトリガー設定が必要:
  - `enqueueJmaXmlEntries`: 短い間隔（例: 5〜10分毎）で実行し、新規entryを取りこぼさないようにする
  - `processJmaXmlQueue`: `enqueueJmaXmlEntries`と同等かそれより高頻度の間隔で実行し、キューに溜まったデータを処理する
- 既存の`fetchJmaXmlToSpreadsheet`用トリガーが設定されている場合、キュー方式との二重実行・二重書き込みにならないよう整理が必要
- `_queue`シートの行数が異常に増え続けていないか（processが追いついているか）の運用監視
