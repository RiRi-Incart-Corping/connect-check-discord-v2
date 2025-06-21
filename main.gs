// v2製品
// This is v2
// ★★★ 設定項目 ★★★
// DiscordウェブフックURL
const WEBHOOK_URL = 'YOUR_DISCORD_WEBHOOK_URL'; // ここをあなたのウェブフックURLに修正

// 監視したいAPIのURL
const API_URL = 'https://api.zpw.jp/connect/v2/serverlist.php';

// 監視対象のサーバー名 (API応答に合わせて正確に入力してください)
const TARGET_SERVER_NAME = '低スペノートで作ったサーバー'; // ここをあなたのサーバー名に修正


const API_BASIC_VALIDATION = (data) => {
  return data && typeof data === 'object' && data.status === 'ok' && typeof data.servers === 'object' && data.servers !== null && !Array.isArray(data.servers);
};

// HTTPリクエストのタイムアウト時間（秒）
const TIMEOUT_SECONDS = 20;

// 状態管理用キーの接頭辞
const KEY_PREFIX = 'server_status_';

// 状態の種類
const STATUS = {
  OK: 'OK', 
  DOWN_NOTIFIED: 'DOWN_NOTIFIED', 
};

// Script Properties に保存するキーの名前
const STATUS_KEY = KEY_PREFIX + 'status_' + Utilities.base64Encode(API_URL + '_' + TARGET_SERVER_NAME).replace(/=/g, '');
// ★ カウント値保存用のキーを追加 ★
const NOTIFICATION_COUNT_KEY = KEY_PREFIX + 'notification_count_' + Utilities.base64Encode(API_URL + '_' + TARGET_SERVER_NAME).replace(/=/g, '');
const DOWN_COUNT_KEY = KEY_PREFIX + 'down_count_' + Utilities.base64Encode(API_URL + '_' + TARGET_SERVER_NAME).replace(/=/g, '');


// ★★★ スクリプト本体 ★★★

/**
 * メイン関数：定期的にAPIから特定のサーバーの状態をチェックし、
 * 状態が変化した場合にのみDiscordに通知します。
 * この関数をトリガーに設定してください。
 */
function checkTargetServerStatusAndNotify() {
  Logger.log(`--- サーバー "${TARGET_SERVER_NAME}" (${API_URL}) チェック開始 (状態変化通知モード) ---`);
  const properties = PropertiesService.getScriptProperties();


  const previousStatus = properties.getProperty(STATUS_KEY) || STATUS.OK;
  Logger.log(`以前の状態: ${previousStatus}`);


  let notificationCount = parseInt(properties.getProperty(NOTIFICATION_COUNT_KEY) || '0', 10);
  let downCount = parseInt(properties.getProperty(DOWN_COUNT_KEY) || '0', 10);
  Logger.log(`現在の統計データ (読込時): 通知回数=${notificationCount}, 接続不可回数=${downCount}`);


  let currentStatusIsDown = false; 
  let details = ''; // 
  let parsedJson = null;

  try {
    Logger.log(`API "${API_URL}" にアクセス中...`);
    const response = UrlFetchApp.fetch(API_URL, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
      timeout: TIMEOUT_SECONDS,
    });

    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();
    Logger.log(`API応答取得成功。HTTPステータスコード: ${statusCode}`);

    if (statusCode < 200 || statusCode >= 300) {
      currentStatusIsDown = true; 
      details = `API応答エラー (HTTPステータスコード: ${statusCode})`;
      Logger.log(`判断: APIのHTTPステータスコードが異常 (${statusCode})`);

    } else {
      try {
        Logger.log(`API応答をJSONパース中...`);
        parsedJson = JSON.parse(responseText);
        Logger.log(`JSONパース成功。`);

        Logger.log(`API応答の基本構造を検証中...`);
        if (!API_BASIC_VALIDATION(parsedJson)) {
          currentStatusIsDown = true;
          details = `API応答データ構造が不正です。`;
          Logger.log(`判断: API応答データ構造が不正`);

        } else {
            Logger.log(`API応答の基本構造は正常です。オンラインサーバーリストを走査中...`);
            let targetServerFound = false;
            const serverGroupsObject = parsedJson.servers;

            for (const clientId in serverGroupsObject) {
                if (serverGroupsObject.hasOwnProperty(clientId)) {
                    const serverGroup = serverGroupsObject[clientId];
                    if (Array.isArray(serverGroup)) {
                        for (const serverDetails of serverGroup) {
                            if (serverDetails && typeof serverDetails === 'object' && serverDetails.hasOwnProperty('server_name')) {
                                if (serverDetails.server_name === TARGET_SERVER_NAME) {
                                    targetServerFound = true;
                                    Logger.log(`対象サーバー "${TARGET_SERVER_NAME}" をオンラインリスト内で発見しました。`);
                                    break;
                                }
                            }
                        }
                    }
                }
                 if (targetServerFound) break;
            }

            if (targetServerFound) {
              currentStatusIsDown = false; 
              details = 'サーバーはオンラインリストに含まれています。';
              Logger.log(`判断: 対象サーバー "${TARGET_SERVER_NAME}" がオンラインリストにあります。サーバーはオンラインと判断。`);
            } else {
              currentStatusIsDown = true; // オフラインと判断
              details = `API応答のオンラインリストに "${TARGET_SERVER_NAME}" が見つかりません。`;
              Logger.log(`判断: 対象サーバー "${TARGET_SERVER_NAME}" がオンラインリストにありません。`);
            }
        }

      } catch (jsonError) {
        currentStatusIsDown = true; 
        details = `API応答が有効なJSONではありません。エラー: ${jsonError.message}`;
        Logger.log(`判断: JSONパースエラー - ${jsonError.message}`);
        Logger.log(`API応答テキストの先頭 (最大500文字): ${responseText ? responseText.substring(0, 500) + '...' : 'なし'}`);
      }
    }

  } catch (e) {
    currentStatusIsDown = true; 
    details = `APIへのネットワークエラー: ${e.message}`;
    Logger.log(`判断: APIへのネットワークエラー - ${e.message}`);
  }


  if (currentStatusIsDown) {
  
    if (previousStatus !== STATUS.DOWN_NOTIFIED) {
 
      Logger.log(`状態変化: OK -> DOWN。オフライン通知を送信します。`);
      // ★ 状態変化(OK->DOWN)が発生★
      notificationCount++; 
      downCount++; 
      sendDiscordNotification(TARGET_SERVER_NAME, API_URL, STATUS.DOWN_NOTIFIED, details, notificationCount, downCount); // カウント値を渡す
      properties.setProperty(STATUS_KEY, STATUS.DOWN_NOTIFIED); 
      // ★ カウント値も保存 ★
      properties.setProperty(NOTIFICATION_COUNT_KEY, notificationCount);
      properties.setProperty(DOWN_COUNT_KEY, downCount);
      Logger.log(`統計データを更新・保存: 通知回数=${notificationCount}, 接続不可回数=${downCount}`);

    } else {
      // 既にオフライン通知済みの場合は何もしない (状態継続)
      Logger.log(`状態継続: DOWN -> DOWN。通知はスキップします。`);
      properties.setProperty(STATUS_KEY, STATUS.DOWN_NOTIFIED); 
 
    }
  } else {

    if (previousStatus === STATUS.DOWN_NOTIFIED) {
 
      Logger.log(`状態変化: DOWN -> OK。オンライン復旧通知を送信します。`);
      // ★ 状態変化(DOWN->OK)が発生 ★
      notificationCount++; 

      sendDiscordNotification(TARGET_SERVER_NAME, API_URL, STATUS.OK, null, notificationCount, downCount); 
      properties.setProperty(STATUS_KEY, STATUS.OK); // 
 
      properties.setProperty(NOTIFICATION_COUNT_KEY, notificationCount);
      properties.setProperty(DOWN_COUNT_KEY, downCount); 
      Logger.log(`統計データを更新・保存: 通知回数=${notificationCount}, 接続不可回数=${downCount}`);

    } else {

      Logger.log(`状態継続: OK -> OK。通知は不要です。`);
      properties.setProperty(STATUS_KEY, STATUS.OK); 
 
    }
  }

  Logger.log(`--- チェック終了 ---`);
}

/**
 * Discordウェブフックに通知を送信する関数。
 * @param {string} serverName 監視対象のサーバー名
 * @param {string} apiUrl 監視に使ったAPI URL
 * @param {string} status 状態 ('OK' or 'DOWN_NOTIFIED')
 * @param {string} [details] ダウン時の詳細メッセージ (オプション)
 * @param {number} notificationCount 現在の通知回数
 * @param {number} downCount 現在の接続不可回数
 */
function sendDiscordNotification(serverName, apiUrl, status, details, notificationCount, downCount) { 
  // ウェブフックURLが設定されていない場合
  if (!WEBHOOK_URL || WEBHOOK_URL === 'YOUR_DISCORD_WEBHOOK_URL') {
    Logger.log('警告: DiscordウェブフックURLが設定されていません。通知送信をスキップします。');
    return;
  }

  let color;      
  let title;      
  let description = ''; // 
  const timestamp = new Date().toISOString(); 

  // 共通の本文部分はここに
  const commonDescription = `\nまた1分置きに確認しているので正確性に問題があります\n詳細なサーバー状態、メンテナンスは\nhttps://connect-server-for-teisupe.kesug.com/`; // 本文２

  if (status === STATUS.DOWN_NOTIFIED) {
    color = 15548997; 
    // ★ 停止時のタイトルと本文 ★
    title = `❌️🔌Connectから切断🔌❌️`; // 停止時のタイトル
    description = `Connectからの切断を検知しました。\n${commonDescription}`; //本文１詳しくは210行目
  
    if (details && details !== 'サーバーはオンラインリストに含まれています。') {
        description += `\n詳細: ${details}`;
    }

  } else if (status === STATUS.OK) {
    color = 3066993;
    // ★ 復旧時のタイトルと本文 ★
    title = `✅️🔌Connectに再接続🔌✅️`; // 復旧タイトル
    description = `Connectに再接続されました。\n参加することができます${commonDescription}`; // 本文１詳しくは210行目

    // ★ 統計データ★
    description += `\n\n統計データ：通知回数→${notificationCount}回｜接続不可→${downCount}回`;

  } else {
  
      Logger.log(`警告: 不明なステータス "${status}" での通知リクエストです。スキップします。`);
      return;
  }

  const payload = {
    // content: '@everyone', // 全体にメンションしたい場合はコメントを外す
    embeds: [
      {
        title: title,
        description: description,
        color: color,
        // fields: [], 
        footer: { text: 'Google Apps Script サーバー状態通知' }, // システム名
        timestamp: timestamp, // 現在時刻をタイムスタンプ
      },
    ],
  };

  try {
    Logger.log(`Discordへの通知送信中... タイトル: "${title}"`);

    const discordResponse = UrlFetchApp.fetch(WEBHOOK_URL, {
      method: 'POST', 
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true, 
    });
  
    Logger.log(`Discordウェブフック応答: ステータスコード ${discordResponse.getResponseCode()}`);

  } catch (e) {
  
    Logger.log(`エラー: Discordへの通知送信に失敗しました: ${e.message}`);
  }
}
