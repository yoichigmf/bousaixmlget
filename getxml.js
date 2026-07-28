/**
 * 気象庁防災情報XML（高頻度フィード）を取得し、SpreadSheetに書き込む。
 * 対象フィード: 気象警報・注意報等(extra.xml) / 地震火山情報(eqvol.xml)
 */

var JMA_FEEDS = [
  { name: 'extra', url: 'https://www.data.jma.go.jp/developer/xml/feed/extra.xml' },
  { name: 'eqvol', url: 'https://www.data.jma.go.jp/developer/xml/feed/eqvol.xml' }
];

var JMA_SHEET_NAME = '気象庁防災情報';

var JMA_HEADER = [
  'フィード', 'entryID', '発表時刻(entry)', 'フィードタイトル', '発表官署(author)', '概要(content)',
  'Controlタイトル', 'Control発表日時', 'ステータス', '発表官署(Control)',
  '発表時刻(Head)', '情報種別(InfoType)', '情報分類(InfoKind)', '見出し', '対象地域(Area)'
];

// 震度階級コード（Body/Intensity/Observation/MaxInt）の並び。震度5弱以上の判定に使用する。
var JMA_INTENSITY_ORDER = ['1', '2', '3', '4', '5-', '5+', '6-', '6+', '7'];
var JMA_INTENSITY_THRESHOLD_INDEX = JMA_INTENSITY_ORDER.indexOf('5-');

// 気象特別警報・警報・注意報の電文の中で、避難情報の目安として通知対象に含める現象名
var JMA_EVACUATION_RELATED_NAMES = ['土砂災害警戒情報'];


function TestPost() {

   const sampleText = '投稿テストです';

   PostSlack( sampleText );

}
function PostSlack( msg ) {
  const props = PropertiesService.getScriptProperties().getProperties();
  const webhookUrl = props.SLACK_WEBHOOK_URL;
  
  UrlFetchApp.fetch(webhookUrl,{
    method: 'post',
    contentType: 'application/json',
    // textに送りたいメッセージを入れる
    payload: JSON.stringify({text: msg }) 
  });
}


/**
 * 気象庁防災情報XML（高頻度フィード）を取得し、アクティブなSpreadSheetに書き込むメイン関数。
 */
function fetchJmaXmlToSpreadsheet() {
  var sheet = getOrCreateJmaSheet_(JMA_SHEET_NAME);
  var existingIds = getExistingEntryIds_(sheet);
  var rowsToAppend = [];
  var alertMessages = [];

  JMA_FEEDS.forEach(function (feed) {
    var entries = fetchFeedEntries_(feed.url);
    entries.forEach(function (entry) {
      if (existingIds[entry.id]) {
        return;
      }
      var detail = fetchEntryDetail_(entry.dataUrl);
      rowsToAppend.push([
        feed.name,
        entry.id,
        entry.updated,
        entry.title,
        entry.author,
        entry.content,
        detail.controlTitle,
        detail.controlDateTime,
        detail.status,
        detail.publishingOffice,
        detail.headReportDateTime,
        detail.infoType,
        detail.infoKind,
        detail.headline,
        detail.areas
      ]);
      existingIds[entry.id] = true;

      var alertReason = getAlertReason_(detail);
      if (alertReason) {
        alertMessages.push(buildAlertMessage_(alertReason, entry, detail));
      }
    });
  });

  appendRows_(sheet, rowsToAppend);

  alertMessages.forEach(function (message) {
    PostSlack(message);
  });

  Logger.log('%s 件の新規データを書き込みました（通知: %s件）。', rowsToAppend.length, alertMessages.length);
}

/**
 * Slack通知の対象に該当するか判定し、該当する場合は理由（種別名）を返す（非該当ならnull）。
 * 対象: 地震(震度5弱以上) / 津波警報・注意報 / 気象特別警報・警報 / 噴火速報・警報 / 土砂災害警戒情報
 */
function getAlertReason_(detail) {
  if (detail.infoKind === '地震情報' && isIntensity5WeakOrMore_(detail.maxInt)) {
    return '地震情報（震度' + formatIntensityLabel_(detail.maxInt) + '以上）';
  }

  if (matchesAnyKeyword_(detail.controlTitle, ['津波警報・注意報・予報'])) {
    var hasTsunamiWarning = detail.kindNames.some(function (name) {
      return matchesAnyKeyword_(name, ['大津波警報', '津波警報', '津波注意報']);
    });
    if (hasTsunamiWarning) {
      return '津波警報・注意報';
    }
  }

  if (matchesAnyKeyword_(detail.controlTitle, ['気象特別警報・警報・注意報'])) {
    var hasWarning = detail.kindNames.some(function (name) {
      return endsWith_(name, '特別警報') || endsWith_(name, '警報');
    });
    if (hasWarning) {
      return '気象特別警報・警報';
    }
  }

  if (matchesAnyKeyword_(detail.controlTitle, JMA_EVACUATION_RELATED_NAMES)) {
    return '土砂災害警戒情報';
  }

  if (detail.infoKind === '噴火警報・予報') {
    var hasEruptionWarning = detail.kindNames.some(function (name) {
      return name.indexOf('噴火警報') !== -1 || name.indexOf('火口周辺警報') !== -1;
    });
    if (hasEruptionWarning) {
      return '噴火警報';
    }
  }

  if (matchesAnyKeyword_(detail.controlTitle, ['噴火速報'])) {
    return '噴火速報';
  }

  return null;
}

/**
 * 震度コードが震度5弱以上かどうか判定する。
 */
function isIntensity5WeakOrMore_(maxInt) {
  var index = JMA_INTENSITY_ORDER.indexOf(maxInt);
  if (index === -1) {
    return false;
  }
  return index >= JMA_INTENSITY_THRESHOLD_INDEX;
}

/**
 * 震度コード（5-, 5+等）を表示用ラベル（5弱, 5強等）に変換する。
 */
function formatIntensityLabel_(maxInt) {
  return maxInt.replace('-', '弱').replace('+', '強');
}

/**
 * 文字列がキーワードのいずれかで終わっているか判定する。
 */
function endsWith_(str, suffix) {
  return str.length >= suffix.length && str.indexOf(suffix, str.length - suffix.length) !== -1;
}

/**
 * タイトルにキーワードのいずれかが部分一致するか判定する。
 */
function matchesAnyKeyword_(title, keywords) {
  if (!title) {
    return false;
  }
  return keywords.some(function (keyword) {
    return title.indexOf(keyword) !== -1;
  });
}

/**
 * Slack投稿用のメッセージ本文を組み立てる。
 */
function buildAlertMessage_(reason, entry, detail) {
  var lines = [
    '【' + reason + '】' + detail.controlTitle,
    detail.headline || entry.content,
    '発表: ' + (detail.headReportDateTime || entry.updated) + '　発表官署: ' + detail.publishingOffice
  ];
  if (detail.areas) {
    lines.push('対象地域: ' + detail.areas);
  }
  lines.push(entry.dataUrl);
  return lines.join('\n');
}

/**
 * 指定シートの末尾に行を追記する。
 */
function appendRows_(sheet, rows) {
  if (rows.length === 0) {
    return;
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, JMA_HEADER.length).setValues(rows);
}

/**
 * 書き込み先シートを取得（無ければ作成しヘッダーを設定）する。
 */
function getOrCreateJmaSheet_(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, JMA_HEADER.length).setValues([JMA_HEADER]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * シート内の既存entryID（B列）を重複チェック用に取得する。
 */
function getExistingEntryIds_(sheet) {
  var ids = {};
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return ids;
  }
  var values = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  values.forEach(function (row) {
    if (row[0]) {
      ids[row[0]] = true;
    }
  });
  return ids;
}

/**
 * Atomフィードを取得し、entry一覧を抽出する。
 */
function fetchFeedEntries_(feedUrl) {
  var xml = UrlFetchApp.fetch(feedUrl, { muteHttpExceptions: true }).getContentText();
  var document = XmlService.parse(xml);
  var atomNs = XmlService.getNamespace('http://www.w3.org/2005/Atom');
  var root = document.getRootElement();
  var entryElements = root.getChildren('entry', atomNs);

  return entryElements.map(function (entry) {
    var linkEl = entry.getChild('link', atomNs);
    return {
      id: getChildText_(entry, 'id', atomNs),
      updated: getChildText_(entry, 'updated', atomNs),
      title: getChildText_(entry, 'title', atomNs),
      author: getAuthorName_(entry, atomNs),
      content: getChildText_(entry, 'content', atomNs),
      dataUrl: linkEl ? linkEl.getAttribute('href').getValue() : ''
    };
  });
}

/**
 * entry内のauthor/name要素を取得する。
 */
function getAuthorName_(entry, atomNs) {
  var authorEl = entry.getChild('author', atomNs);
  if (!authorEl) {
    return '';
  }
  return getChildText_(authorEl, 'name', atomNs);
}

/**
 * 個別データXML(JMAXML)を取得し、Control/Headの主要項目を抽出する。
 */
function fetchEntryDetail_(dataUrl) {
  var empty = {
    controlTitle: '', controlDateTime: '', status: '', publishingOffice: '',
    headReportDateTime: '', infoType: '', infoKind: '', headline: '', areas: '',
    kindNames: [], maxInt: ''
  };
  if (!dataUrl) {
    return empty;
  }

  var xml = UrlFetchApp.fetch(dataUrl, { muteHttpExceptions: true }).getContentText();
  var document = XmlService.parse(xml);
  var root = document.getRootElement();
  var reportNs = root.getNamespace();

  var controlEl = root.getChild('Control', reportNs);
  var headEl = getHeadElement_(root);

  var result = {
    controlTitle: controlEl ? getChildText_(controlEl, 'Title', reportNs) : '',
    controlDateTime: controlEl ? getChildText_(controlEl, 'DateTime', reportNs) : '',
    status: controlEl ? getChildText_(controlEl, 'Status', reportNs) : '',
    publishingOffice: controlEl ? getChildText_(controlEl, 'PublishingOffice', reportNs) : '',
    headReportDateTime: '',
    infoType: '',
    infoKind: '',
    headline: '',
    areas: '',
    kindNames: [],
    maxInt: ''
  };

  if (headEl) {
    var headNs = headEl.getNamespace();
    result.headReportDateTime = getChildText_(headEl, 'ReportDateTime', headNs);
    result.infoType = getChildText_(headEl, 'InfoType', headNs);
    result.infoKind = getChildText_(headEl, 'InfoKind', headNs);

    var headlineEl = headEl.getChild('Headline', headNs);
    if (headlineEl) {
      result.headline = getChildText_(headlineEl, 'Text', headNs);
    }

    result.areas = collectAreaNames_(headEl).join(', ');
    result.kindNames = collectKindNames_(headEl);
  }

  result.maxInt = findMaxIntensity_(root);

  return result;
}

/**
 * Head配下に含まれる全てのInformation/Item/Kind/Name要素を再帰的に収集する（警報種別・現象名の判定に使用）。
 */
function collectKindNames_(element) {
  var names = [];

  function walk(el) {
    var children = el.getChildren();
    children.forEach(function (child) {
      if (child.getName() === 'Kind') {
        var nameEl = child.getChild('Name', child.getNamespace());
        if (nameEl) {
          names.push(nameEl.getText());
        }
      }
      walk(child);
    });
  }

  walk(element);
  return names;
}

/**
 * Report全体からBody/Intensity/Observation/MaxInt（全国最大震度）を検索する（震度速報等では存在しない場合がある）。
 */
function findMaxIntensity_(root) {
  var bodyEl = null;
  var children = root.getChildren();
  for (var i = 0; i < children.length; i++) {
    if (children[i].getName() === 'Body') {
      bodyEl = children[i];
      break;
    }
  }
  if (!bodyEl) {
    return '';
  }

  var bodyNs = bodyEl.getNamespace();
  var intensityEl = bodyEl.getChild('Intensity', bodyNs);
  if (!intensityEl) {
    return '';
  }
  var observationEl = intensityEl.getChild('Observation', bodyNs);
  if (!observationEl) {
    return '';
  }
  return getChildText_(observationEl, 'MaxInt', bodyNs).trim();
}

/**
 * Head配下に含まれる全てのArea/Name要素を再帰的に収集し、重複を除いた配列で返す（階層は区別しない）。
 */
function collectAreaNames_(element) {
  var names = [];
  var seen = {};

  function walk(el) {
    var children = el.getChildren();
    children.forEach(function (child) {
      if (child.getName() === 'Area') {
        var nameEl = child.getChild('Name', child.getNamespace());
        var name = nameEl ? nameEl.getText() : '';
        if (name && !seen[name]) {
          seen[name] = true;
          names.push(name);
        }
      }
      walk(child);
    });
  }

  walk(element);
  return names;
}

/**
 * Report直下のHead要素を取得する（Headは独自の名前空間を持つ場合があるため子要素を走査）。
 */
function getHeadElement_(root) {
  var children = root.getChildren();
  for (var i = 0; i < children.length; i++) {
    if (children[i].getName() === 'Head') {
      return children[i];
    }
  }
  return null;
}

/**
 * 指定した子要素のテキストを取得する（存在しない場合は空文字）。
 */
function getChildText_(parentEl, childName, ns) {
  var child = ns ? parentEl.getChild(childName, ns) : parentEl.getChild(childName);
  return child ? child.getText() : '';
}
