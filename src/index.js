import fs from "fs";
import yaml from "js-yaml";
import ChinaRailway from "./cr.js";
import { Notifications } from "./notifications.js";
import { sleep, time, log, asset } from "./utils.js";

let config;
let notifications = [];
let updateTimer = null;

function die(err) {
  if (err && err != "SIGINT") {
    log.error("发生错误：", err);
    log.line();
  }
  sendMsg({
    time: new Date().toLocaleString(),
    content: `车票监控程序异常退出：${err.message || err}`,
  });
  log.info("程序已结束，将在 5 秒后退出");
  process.exit();
}

function clean() {
  for (let notification of notifications) {
    notification.die();
  }
  if (updateTimer) {
    clearInterval(updateTimer);
    clearTimeout(updateTimer);
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
}

async function sendMsg(msg) {
  for (let notification of notifications) {
    if (notification.info.name === "飞书推送") {
      const formattedMsg = `[车票监控]\n🕒 时间：${msg.time}\n📝 内容：${msg.content}`;
      notification.send(formattedMsg).catch((err) => {
        log.error(
          `${notification.info.name} (${notification.info.description}) 发送失败：${err}`
        );
      });
    } else if (notification.info.name === "Telegram推送") {
      const formattedMsg = `🚄 *车票监控*\n\n🕒 *时间：* ${msg.time}\n📝 *内容：* ${msg.content}`;
      notification.send(formattedMsg).catch((err) => {
        log.error(
          `${notification.info.name} (${notification.info.description}) 发送失败：${err}`
        );
      });
    } else if (notification.info.name === "企业微信推送") {
      const formattedMsg = `[车票监控]\n🕒 时间：${msg.time}\n📝 内容：${msg.content}`;
      notification.send(formattedMsg).catch((err) => {
        log.error(
          `${notification.info.name} (${notification.info.description}) 发送失败：${err}`
        );
      });
    } else {
      notification.send(msg).catch((err) => {
        log.error(
          `${notification.info.name} (${notification.info.description}) 发送失败：${err}`
        );
      });
    }
  }
}

async function searchTickets(search) {
  log.info(`查询 ${search.date} ${search.from}→${search.to} 车票：`);
  let data = await ChinaRailway.checkTickets(
    search.date,
    await ChinaRailway.getStationCode(search.from),
    await ChinaRailway.getStationCode(search.to)
  );
  for (let row of data.data.result) {
    let trainInfo = ChinaRailway.parseTrainInfo(row);
    if (!search.trains) {
      await determineRemainTickets(trainInfo);
    } else {
      for (let train of search.trains) {
        if (
          train.code == trainInfo.station_train_code &&
          (train.from === undefined ||
            train.from ==
              ChinaRailway.stationName[trainInfo.from_station_telecode]) &&
          (train.to === undefined ||
            train.to == ChinaRailway.stationName[trainInfo.to_station_telecode])
        ) {
          await determineRemainTickets(
            trainInfo,
            train.seatCategory,
            train.checkRoundTrip ?? false
          );
        }
      }
    }
  }
}

async function determineRemainTickets(
  trainInfo,
  seatCategory = undefined,
  checkRoundTrip = false
) {
  let trainDescription =
    trainInfo.station_train_code +
    " " +
    (await ChinaRailway.getStationName(trainInfo.from_station_telecode)) +
    "→" +
    (await ChinaRailway.getStationName(trainInfo.to_station_telecode));

  let { remain, msg } = await checkRemainTickets(
    trainInfo,
    seatCategory,
    checkRoundTrip
  );

  msg = msg || "无剩余票";

  if (!remain && seatCategory !== undefined) {
    msg = seatCategory.join("/") + " " + msg;
  }

  log.info("-", trainDescription, msg);

  if (remain) {
    const messageToSend = {
      time: new Date().toLocaleString(),
      content: trainDescription + "\n" + msg,
    };

    sendMsg(messageToSend);
  }
}

async function checkRemainTickets(trainInfo, seatCategory, checkRoundTrip) {
  let remainTypes = [];
  let remainTotal = 0;
  for (let type of Object.keys(trainInfo.tickets)) {
    if (seatCategory !== undefined && !seatCategory.includes(type)) {
      continue;
    }
    if (trainInfo.tickets[type] != "" && trainInfo.tickets[type] != "无") {
      remainTypes.push(type + " " + trainInfo.tickets[type]);
      if (trainInfo.tickets[type] == "有") {
        remainTotal += Infinity;
      } else {
        remainTotal += parseInt(trainInfo.tickets[type]);
      }
    }
  }
  if (remainTypes.length) {
    return {
      remain: true,
      total: remainTotal >= 20 ? "≥20" : remainTotal,
      msg: remainTypes.join(" / "),
    };
  }
  if (!checkRoundTrip) {
    return {
      remain: false,
      msg: "区间无票",
    };
  }
  let roundTripData = await ChinaRailway.checkTickets(
    trainInfo.start_train_date,
    trainInfo.start_station_telecode,
    trainInfo.end_station_telecode,
    sleep(config.delay * 1000)
  );
  for (let row of roundTripData.data.result) {
    let roundTripInfo = ChinaRailway.parseTrainInfo(row);
    if (
      trainInfo.station_train_code == roundTripInfo.station_train_code &&
      trainInfo.start_station_telecode == roundTripInfo.from_station_telecode &&
      trainInfo.end_station_telecode == roundTripInfo.to_station_telecode
    ) {
      let { remain: roundTripRemain, total: roundTripRemainTotal } =
        await checkRemainTickets(roundTripInfo, seatCategory, false);
      return {
        remain: false,
        msg: `区间无票，全程${
          roundTripRemain ? `有票 (${roundTripRemainTotal}张)` : "无票"
        }`,
      };
    }
  }
  return {
    remain: false,
    msg: "区间无票，全程未知",
  };
}

async function update() {
  log.info("开始查询余票");
  try {
    for (let search of config.watch) {
      await searchTickets(search);
      await sleep(config.delay * 1000);
    }
    ChinaRailway.clearTicketCache();
  } catch (e) {
    log.error(e);
    sendMsg({
      time: new Date().toLocaleString(),
      content: "错误：" + e.message,
    });
  }
  log.info("余票查询完成");
  log.line();
}

function checkConfig() {
  try {
    config = fs.readFileSync("config.yml", "UTF-8");
  } catch (err) {
    if (err.code == "ENOENT") {
      log.error("config.yml 不存在");
      try {
        fs.writeFileSync("config.yml", asset("config.example.yml"));
        log.info("已自动创建 config.yml");
        log.info("请根据需要修改后重启程序");
      } catch (err) {
        log.error("创建 config.yml 失败");
        log.info("请自行创建后重启程序");
      }
    } else {
      log.error("读取 config.yml 时发生错误：", err);
    }
    die("配置文件错误");
  }
  try {
    config = yaml.load(config);
  } catch (err) {
    log.error("解析 config.yml 时发生错误：", err);
    die("配置文件解析错误");
  }

  let configParsing = "当前配置文件：\n\n";
  if (!config.watch || !config.watch.length) {
    log.error("未配置搜索条件");
    die();
  }
  for (let search of config.watch) {
    if (!search.date || !search.from || !search.to) {
      log.error("搜索条件不完整");
      die();
    }
    configParsing += search.date + " " + search.from + "→" + search.to + "\n";
    if (search.trains && search.trains.length) {
      for (let train of search.trains) {
        if (!train.code) {
          log.error("未填写车次号");
          die();
        }
        configParsing +=
          "- " +
          train.code +
          " " +
          (train.from ?? "(*)") +
          "→" +
          (train.to ?? "(*)") +
          " " +
          (train.seatCategory ? train.seatCategory.join("/") : "全部席别") +
          " " +
          (train.checkRoundTrip ? "[✓]" : "[×]") +
          "查询全程票\n";
      }
    } else {
      configParsing += "- 全部车次\n";
    }
    configParsing += "\n";
  }

  // 清理旧的通知实例
  for (let notification of notifications) {
    notification.die();
  }
  notifications = [];

  for (let notification of config.notifications) {
    try {
      let n = new Notifications[notification.type](notification); // 确保实例化时使用正确的键名
      notifications.push(n);
      configParsing +=
        `已配置消息推送：${n.info.name} (${n.info.description})` + "\n";
    } catch (e) {
      log.error("配置消息推送时发生错误：", e);
    }
  }
  if (!notifications.length) {
    log.warn("未配置消息推送");
    configParsing += "未配置消息推送\n";
  }
  configParsing += "\n";

  if (!config.interval) config.interval = 15;
  if (!config.delay) config.delay = 5;
  configParsing += `查询间隔：${config.interval}分钟，访问延迟：${config.delay}秒`;

  log.line();
  log.direct(configParsing);
  log.line();

  sendMsg({
    time: new Date().toLocaleString(),
    content: configParsing,
  }).then(() => {
    log.info("已尝试发送提醒，如未收到请检查配置");
  });
}

function reloadConfig() {
  log.info("检测到配置文件变化，正在重新加载...");

  // 清除现有定时器
  if (updateTimer) {
    clearInterval(updateTimer);
    clearTimeout(updateTimer);
    updateTimer = null;
  }

  try {
    checkConfig();

    // 重新启动定时器
    startMonitoring();

    log.info("配置文件重新加载完成");
    sendMsg({
      time: new Date().toLocaleString(),
      content: "配置文件已重新加载，监控已重新启动",
    });
  } catch (err) {
    log.error("重新加载配置文件失败：", err);
    sendMsg({
      time: new Date().toLocaleString(),
      content: `配置文件重新加载失败：${err.message || err}`,
    });
  }
}

function startMonitoring() {
  log.info("5秒后开始首次查询，按 Ctrl+C 中止");
  updateTimer = setInterval(update, config.interval * 60 * 1000);
  setTimeout(update, 5 * 1000);
}

function watchConfigFile() {
  try {
    fs.watchFile("config.json", { interval: 1000 }, (curr, prev) => {
      if (curr.mtime > prev.mtime) {
        // 延迟一下，确保文件写入完成
        setTimeout(reloadConfig, 500);
      }
    });
    log.info("已启用配置文件热重载监控");
  } catch (err) {
    log.warn("启用配置文件监控失败：", err);
  }
}

process.title = "CR Ticket Monitor";
process.on("uncaughtException", die);
process.on("unhandledRejection", die);
process.on("SIGINT", die);
process.on("exit", clean);

console.clear();
log.title(String.raw`
           __________  ________  ___
          / ____/ __ \/_  __/  |/  /
         / /   / /_/ / / / / /|_/ /
        / /___/ _  _/ / / / /  / /
        \____/_/ |_| /_/ /_/  /_/

`);
log.line();

checkConfig();
watchConfigFile();
startMonitoring();
