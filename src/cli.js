import inquirer from "inquirer";
import chalk from "chalk";
import chalkTable from "chalk-table";
import ChinaRailway from "./cr.js";
import fs from "fs";
import yaml from "js-yaml";

// 自定义中文提示语
const chinesePrompts = {
  checkbox: {
    help: "(使用 ↑↓ 移动，空格 选择，a 全选，i 反选，回车 确认)",
    selected: "已选择",
    unselected: "未选择",
  },
  list: {
    help: "(使用 ↑↓ 移动，回车 确认)",
  },
  confirm: {
    help: "(y/n)",
  },
  input: {
    help: "请输入后按回车确认",
  },
};

// 创建自定义 prompt 函数
async function promptWithChinese(questions) {
  // 为每个问题添加中文提示
  const processedQuestions = questions.map((q) => {
    const newQ = { ...q };

    switch (q.type) {
      case "checkbox":
        newQ.message =
          q.message + " " + chalk.gray(chinesePrompts.checkbox.help);
        break;
      case "list":
        newQ.message = q.message + " " + chalk.gray(chinesePrompts.list.help);
        break;
      case "confirm":
        newQ.message =
          q.message + " " + chalk.gray(chinesePrompts.confirm.help);
        break;
      case "input":
      case "number":
        if (!q.message.includes("请输入")) {
          newQ.message = q.message + " " + chalk.gray("(请输入后按回车确认)");
        }
        break;
    }

    return newQ;
  });

  return await inquirer.prompt(processedQuestions);
}

async function main() {
  console.clear();
  console.log(chalk.cyan.bold("\n=== 12306 余票监控交互模式 ===\n"));

  while (true) {
    // 主菜单
    const { action } = await promptWithChinese([
      {
        type: "list",
        name: "action",
        message: "请选择操作:",
        choices: [
          { name: "🔍 查询车次并配置监控", value: "query" },
          { name: "⚙️  编辑现有配置", value: "edit" },
          { name: "📊 查看当前配置", value: "view" },
          { name: "🚀 直接启动监控", value: "start" },
          { name: "❌ 退出", value: "exit" },
        ],
      },
    ]);

    switch (action) {
      case "query":
        await queryAndConfig();
        break;
      case "edit":
        await editConfig();
        break;
      case "view":
        await viewConfig();
        break;
      case "start":
        await startMonitoring();
        return; // 启动监控后退出交互模式
      case "exit":
        console.log(chalk.yellow("已退出"));
        process.exit(0);
    }

    // 操作完成后显示分隔线
    console.log(chalk.gray("\n" + "=".repeat(50)));
  }
}

async function queryAndConfig(isFirstTime = true) {
  // 1. 输入出发地、目的地、日期
  const { from, to, date } = await promptWithChinese([
    {
      name: "from",
      message: "请输入出发地(如: 上海):",
      validate: (v) => (v.trim() ? true : "不能为空"),
    },
    {
      name: "to",
      message: "请输入目的地(如: 北京):",
      validate: (v) => (v.trim() ? true : "不能为空"),
    },
    {
      name: "date",
      message: "请输入日期(YYYYMMDD):",
      validate: (v) => (/^\d{8}$/.test(v) ? true : "格式错误，请输入8位数字"),
    },
  ]);

  // 2. 查询车次
  const fromCode = await ChinaRailway.getStationCode(from);
  const toCode = await ChinaRailway.getStationCode(to);
  if (!fromCode || !toCode) {
    console.log(chalk.red("站点名称无效，请检查输入！"));
    return;
  }
  let data;
  try {
    console.log(chalk.blue("正在查询车次信息..."));
    data = await ChinaRailway.checkTickets(date, fromCode, toCode);
  } catch (e) {
    console.log(chalk.red("查询失败:"), e.message);
    return;
  }
  const trains = data.data.result.map((row) =>
    ChinaRailway.parseTrainInfo(row)
  );
  if (!trains.length) {
    console.log(chalk.yellow("无可用车次！"));
    return;
  }

  // 3. 显示车次列表
  console.log(chalk.blue(`\n找到 ${trains.length} 个车次：\n`));

  const tableData = await Promise.all(
    trains.map(async (train) => ({
      车次: chalk.green(train.station_train_code),
      出发站: await ChinaRailway.getStationName(train.from_station_telecode),
      到达站: await ChinaRailway.getStationName(train.to_station_telecode),
      发车时间: train.start_time,
      到达时间: train.arrive_time,
      历时: train.lishi,
      商务座: train.tickets.商务座 || "--",
      一等座: train.tickets.一等座 || "--",
      二等座: train.tickets.二等座 || "--",
      硬卧: train.tickets.硬卧 || "--",
      硬座: train.tickets.硬座 || "--",
    }))
  );

  const table = chalkTable(
    {
      leftPad: 2,
      columns: [
        { field: "车次", name: "车次" },
        { field: "出发站", name: "出发站" },
        { field: "到达站", name: "到达站" },
        { field: "发车时间", name: "发车" },
        { field: "到达时间", name: "到达" },
        { field: "历时", name: "历时" },
        { field: "商务座", name: "商务座" },
        { field: "一等座", name: "一等座" },
        { field: "二等座", name: "二等座" },
        { field: "硬卧", name: "硬卧" },
        { field: "硬座", name: "硬座" },
      ],
    },
    tableData
  );
  console.log(table);

  // 4. 选择车次并配置详细参数
  const { selectedTrains } = await promptWithChinese([
    {
      type: "checkbox",
      name: "selectedTrains",
      message: "请选择要监控的车次(可多选):",
      choices: trains.map((t) => ({
        name: `${t.station_train_code} ${t.start_time}-${t.arrive_time}`,
        value: t,
      })),
      validate: (answer) => {
        if (answer.length < 1) {
          return "至少选择一个车次";
        }
        return true;
      },
    },
  ]);

  if (!selectedTrains.length) {
    console.log(chalk.yellow("未选择任何车次，已退出。"));
    return;
  }

  // 5. 为每个选中的车次配置详细参数
  const configuredTrains = [];
  for (const train of selectedTrains) {
    console.log(chalk.cyan(`\n配置车次 ${train.station_train_code}:`));

    const { seatTypes, checkRoundTrip } = await promptWithChinese([
      {
        type: "checkbox",
        name: "seatTypes",
        message: "选择要监控的席别(不选择则监控所有席别):",
        choices: [
          { name: "商务座", value: "商务座" },
          { name: "特等座", value: "特等座" },
          { name: "一等座", value: "一等座" },
          { name: "二等座", value: "二等座" },
          { name: "软卧", value: "软卧" },
          { name: "硬卧", value: "硬卧" },
          { name: "软座", value: "软座" },
          { name: "硬座", value: "硬座" },
          { name: "无座", value: "无座" },
        ],
      },
      {
        type: "confirm",
        name: "checkRoundTrip",
        message: "是否查询全程票情况?",
        default: false,
      },
    ]);

    const trainConfig = {
      code: train.station_train_code,
      from: await ChinaRailway.getStationName(train.from_station_telecode),
      to: await ChinaRailway.getStationName(train.to_station_telecode),
      checkRoundTrip,
    };

    if (seatTypes.length > 0) {
      trainConfig.seatCategory = seatTypes;
    }

    configuredTrains.push(trainConfig);
  }

  // 6. 配置推送方式
  const { useNotifications } = await promptWithChinese([
    {
      type: "confirm",
      name: "useNotifications",
      message: "是否配置推送通知?",
      default: false,
    },
  ]);

  let notifications = [];
  if (useNotifications) {
    const { notificationType } = await promptWithChinese([
      {
        type: "list",
        name: "notificationType",
        message: "选择推送方式:",
        choices: [
          { name: "飞书推送", value: "Lark" },
          { name: "Telegram推送", value: "Telegram" },
          { name: "企业微信推送", value: "WechatWork" },
          { name: "Bark推送", value: "Bark" },
          { name: "SMTP邮件推送", value: "SMTP" },
        ],
      },
    ]);

    if (notificationType === "Lark") {
      const { webhook } = await promptWithChinese([
        {
          name: "webhook",
          message: "请输入飞书机器人Webhook URL:",
          validate: (v) =>
            v.includes("feishu.cn")
              ? true
              : "URL格式错误，请输入正确的飞书机器人URL",
        },
      ]);

      const { needSecret } = await promptWithChinese([
        {
          type: "confirm",
          name: "needSecret",
          message: "是否启用签名校验？（建议启用以提高安全性）",
          default: false,
        },
      ]);

      let secret = "";
      if (needSecret) {
        const secretInput = await promptWithChinese([
          {
            name: "secret",
            message: "请输入签名密钥（从飞书机器人安全设置中获取）:",
            validate: (v) => (v.trim() ? true : "密钥不能为空"),
          },
        ]);
        secret = secretInput.secret;
      }

      const larkConfig = { type: "Lark", webhook };
      if (secret) {
        larkConfig.secret = secret;
      }
      notifications.push(larkConfig);
    } else if (notificationType === "Telegram") {
      const { botToken, chatId } = await promptWithChinese([
        {
          name: "botToken",
          message: "请输入Telegram Bot Token:",
          validate: (v) =>
            v.includes(":") ? true : "格式错误，Token应包含冒号",
        },
        {
          name: "chatId",
          message: "请输入Chat ID:",
          validate: (v) => (v.trim() ? true : "Chat ID不能为空"),
        },
      ]);
      notifications.push({ type: "Telegram", botToken, chatId });
    } else if (notificationType === "WechatWork") {
      const { webhook } = await promptWithChinese([
        {
          name: "webhook",
          message: "请输入企业微信机器人Webhook URL:",
          validate: (v) =>
            v.includes("qyapi.weixin.qq.com")
              ? true
              : "URL格式错误，请输入正确的企业微信机器人URL",
        },
      ]);
      notifications.push({ type: "WechatWork", webhook });
    } else if (notificationType === "Bark") {
      const barkConfig = await promptWithChinese([
        {
          name: "deviceKey",
          message: "请输入Bark设备密钥(Device Key):",
          validate: (v) => (v.trim() ? true : "设备密钥不能为空"),
        },
        {
          name: "serverUrl",
          message: "请输入Bark服务器地址(默认: https://api.day.app):",
          default: "https://api.day.app",
        },
        {
          name: "group",
          message: "推送分组名称(可选):",
          default: "火车票监控",
        },
        {
          name: "sound",
          message: "推送声音(可选, 默认: default):",
          default: "default",
        },
      ]);

      // 询问是否配置高级选项
      const { useAdvanced } = await promptWithChinese([
        {
          type: "confirm",
          name: "useAdvanced",
          message: "是否配置高级选项(推送级别、图标等)?",
          default: false,
        },
      ]);

      if (useAdvanced) {
        const advancedConfig = await promptWithChinese([
          {
            type: "list",
            name: "level",
            message: "推送级别:",
            choices: [
              { name: "默认(active)", value: "active" },
              { name: "重要警告(critical)", value: "critical" },
              { name: "时效性通知(timeSensitive)", value: "timeSensitive" },
              { name: "仅添加到列表(passive)", value: "passive" },
            ],
            default: "active",
          },
          {
            name: "icon",
            message: "自定义图标URL(可选):",
          },
          {
            name: "url",
            message: "点击跳转URL(可选):",
          },
          {
            type: "confirm",
            name: "autoCopy",
            message: "自动复制推送内容?",
            default: false,
          },
          {
            type: "confirm",
            name: "isArchive",
            message: "保存推送到历史记录?",
            default: true,
          },
        ]);

        Object.assign(barkConfig, advancedConfig);
      }

      notifications.push({ type: "Bark", ...barkConfig });
    } else if (notificationType === "SMTP") {
      console.log(chalk.cyan("配置SMTP邮件推送:"));

      const smtpConfig = await promptWithChinese([
        {
          name: "host",
          message: "SMTP服务器地址(如: smtp.gmail.com):",
          validate: (v) => (v.trim() ? true : "SMTP服务器地址不能为空"),
        },
        {
          type: "number",
          name: "port",
          message: "SMTP端口号(常用: 587-STARTTLS, 465-SSL, 25-无加密):",
          default: 587,
          validate: (v) =>
            v > 0 && v <= 65535 ? true : "端口号必须在1-65535之间",
        },
        {
          name: "user",
          message: "邮箱用户名:",
          validate: (v) => (v.trim() ? true : "邮箱用户名不能为空"),
        },
        {
          type: "password",
          name: "pass",
          message: "邮箱密码或应用密码:",
          validate: (v) => (v.trim() ? true : "密码不能为空"),
        },
        {
          name: "from",
          message: "发件人显示名称(可选, 默认使用用户名):",
        },
        {
          name: "to",
          message: "收件人邮箱地址:",
          validate: (v) => {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return emailRegex.test(v.trim()) ? true : "请输入有效的邮箱地址";
          },
        },
      ]);

      // 询问是否配置高级选项
      const { useAdvancedSMTP } = await promptWithChinese([
        {
          type: "confirm",
          name: "useAdvancedSMTP",
          message: "是否配置高级选项(安全连接、抄送等)?",
          default: false,
        },
      ]);

      if (useAdvancedSMTP) {
        const advancedSMTPConfig = await promptWithChinese([
          {
            type: "list",
            name: "secure",
            message: "安全连接类型:",
            choices: [
              { name: "自动检测(推荐)", value: undefined },
              { name: "SSL/TLS (端口465)", value: true },
              { name: "STARTTLS (端口587)", value: false },
            ],
            default: undefined,
          },
          {
            name: "cc",
            message: "抄送邮箱(多个用逗号分隔, 可选):",
          },
          {
            name: "bcc",
            message: "密送邮箱(多个用逗号分隔, 可选):",
          },
          {
            name: "replyTo",
            message: "回复邮箱(可选):",
          },
        ]);

        Object.assign(smtpConfig, advancedSMTPConfig);
      }

      notifications.push({ type: "SMTP", ...smtpConfig });
    }
  }

  // 7. 配置监控参数
  const { interval, delay } = await promptWithChinese([
    {
      type: "number",
      name: "interval",
      message: "查询间隔(分钟):",
      default: 15,
      validate: (v) => (v > 0 ? true : "间隔时间必须大于0分钟"),
    },
    {
      type: "number",
      name: "delay",
      message: "访问延迟(秒):",
      default: 5,
      validate: (v) => (v >= 0 ? true : "延迟时间必须大于等于0秒"),
    },
  ]);

  // 8. 生成配置
  const config = {
    watch: [
      {
        from,
        to,
        date,
        trains: configuredTrains,
      },
    ],
    notifications,
    interval,
    delay,
  };

  // 只有首次配置时才直接保存文件
  if (isFirstTime) {
    fs.writeFileSync(
      "config.yml",
      yaml.dump(config, { quotingType: '"', forceQuotes: false }),
      "utf-8"
    );
    console.log(chalk.green("\n✅ 配置已保存到 config.yml"));
  }

  console.log(chalk.blue("\n📋 配置摘要:"));
  console.log(chalk.white(`📍 监控路线: ${from} → ${to}`));
  console.log(chalk.white(`📅 出行日期: ${date}`));
  console.log(chalk.white(`🚄 监控车次: ${configuredTrains.length} 个`));
  console.log(
    chalk.white(
      `📲 推送方式: ${notifications.length ? notifications[0].type : "无"}`
    )
  );
  console.log(chalk.white(`⏰ 查询间隔: ${interval} 分钟`));

  // 9. 只有在首次配置时才询问是否立即开始监控
  if (isFirstTime) {
    const { startNow } = await promptWithChinese([
      {
        type: "confirm",
        name: "startNow",
        message: "是否立即开始监控?",
        default: true,
      },
    ]);

    if (startNow) {
      console.log(chalk.green("\n正在启动监控程序...\n"));
      const { spawn } = await import("child_process");
      spawn("node", ["src/index.js"], { stdio: "inherit", cwd: process.cwd() });
    } else {
      // 如果是首次配置且选择不立即启动，询问是否返回主菜单
      const { backToMenu } = await promptWithChinese([
        {
          type: "confirm",
          name: "backToMenu",
          message: "是否返回主菜单?",
          default: true,
        },
      ]);

      if (backToMenu) {
        console.log(chalk.cyan("\n返回主菜单..."));
        return config;
      }
    }
  }

  return config;
}

async function editConfig() {
  try {
    const configContent = fs.readFileSync("config.yml", "utf-8");
    const config = yaml.load(configContent);

    console.log(chalk.blue("\n📋 当前配置预览:"));
    console.log(chalk.cyan("监控任务:"));
    config.watch.forEach((watch, index) => {
      console.log(
        chalk.white(
          `  ${index + 1}. ${watch.from} → ${watch.to} (${watch.date})`
        )
      );
      if (watch.trains && watch.trains.length > 0) {
        console.log(
          chalk.gray(`     车次: ${watch.trains.map((t) => t.code).join(", ")}`)
        );
      }
    });

    console.log(chalk.cyan("推送配置:"));
    if (config.notifications && config.notifications.length > 0) {
      config.notifications.forEach((notif, index) => {
        let details = "";
        if (notif.type === "Lark") {
          details = notif.webhook?.match(/^https?:\/\/(.+?)\/.*$/)?.[1] || "";
          if (notif.secret) {
            details += " (已启用签名校验)";
          }
        } else if (notif.type === "Telegram") {
          details = `Chat ID: ${notif.chatId || ""}`;
        } else if (notif.type === "WechatWork") {
          details =
            notif.webhook?.match(/key=([^&]+)/)?.[1]?.substring(0, 8) + "..." ||
            "";
        } else if (notif.type === "Bark") {
          details = `设备: ${notif.deviceKey?.substring(0, 8)}...`;
          if (notif.group) details += `, 分组: ${notif.group}`;
        } else if (notif.type === "SMTP") {
          details = `邮箱: ${notif.to}`;
          if (notif.host) details += ` (${notif.host})`;
        }
        console.log(
          chalk.white(
            `  ${index + 1}. ${notif.type}${details ? ` (${details})` : ""}`
          )
        );
      });
    } else {
      console.log(chalk.gray("  未配置推送"));
    }

    console.log(chalk.cyan("查询参数:"));
    console.log(
      chalk.white(
        `  间隔: ${config.interval || 15}分钟, 延迟: ${config.delay || 5}秒`
      )
    );
    console.log();

    const { editType } = await promptWithChinese([
      {
        type: "list",
        name: "editType",
        message: "选择编辑类型:",
        choices: [
          { name: "➕ 添加监控任务", value: "add" },
          { name: "✏️  修改监控任务", value: "editWatch" },
          { name: "🗑️  删除监控任务", value: "deleteWatch" },
          { name: "📲 修改推送配置", value: "notification" },
          { name: "⚙️  修改查询参数", value: "params" },
          { name: "🔄 重置全部配置", value: "reset" },
          { name: "❌ 返回主菜单", value: "back" },
        ],
      },
    ]);

    switch (editType) {
      case "add":
        await addMonitorTask(config);
        break;
      case "editWatch":
        await editMonitorTask(config);
        break;
      case "deleteWatch":
        await deleteMonitorTask(config);
        break;
      case "notification":
        await editNotificationConfig(config);
        break;
      case "params":
        await editQueryParams(config);
        break;
      case "reset":
        await resetConfig();
        break;
      case "back":
        console.log(chalk.yellow("返回主菜单"));
        return;
    }
  } catch (err) {
    console.log(chalk.red("配置文件不存在或格式错误:", err.message));
  }
}

// 添加监控任务
async function addMonitorTask(config) {
  console.log(chalk.cyan("\n➕ 添加新的监控任务"));
  const newTask = await queryAndConfig(false);
  if (newTask && newTask.watch && newTask.watch[0]) {
    // 添加监控任务
    config.watch.push(newTask.watch[0]);

    // 合并推送配置（如果新任务包含推送配置）
    if (newTask.notifications && newTask.notifications.length > 0) {
      if (!config.notifications) {
        config.notifications = [];
      }

      // 检查是否有重复的推送配置，避免重复添加
      for (const newNotif of newTask.notifications) {
        const isDuplicate = config.notifications.some((existingNotif) => {
          if (existingNotif.type !== newNotif.type) return false;

          // 根据不同类型检查是否重复
          switch (newNotif.type) {
            case "Lark":
            case "WechatWork":
              return existingNotif.webhook === newNotif.webhook;
            case "Telegram":
              return (
                existingNotif.botToken === newNotif.botToken &&
                existingNotif.chatId === newNotif.chatId
              );
            case "Bark":
              return existingNotif.deviceKey === newNotif.deviceKey;
            case "SMTP":
              return (
                existingNotif.host === newNotif.host &&
                existingNotif.user === newNotif.user &&
                existingNotif.to === newNotif.to
              );
            default:
              return false;
          }
        });

        if (!isDuplicate) {
          config.notifications.push(newNotif);
        } else {
          console.log(
            chalk.yellow(`⚠️  推送配置 ${newNotif.type} 已存在，跳过添加`)
          );
        }
      }
    }

    // 更新查询参数（如果新任务设置了新的参数）
    if (newTask.interval !== undefined) {
      config.interval = newTask.interval;
    }
    if (newTask.delay !== undefined) {
      config.delay = newTask.delay;
    }

    fs.writeFileSync("config.yml", yaml.dump(config), "utf-8");
    console.log(chalk.green("✅ 监控任务已添加!"));

    // 显示添加的内容摘要
    console.log(chalk.blue("\n📋 添加的内容:"));
    console.log(
      chalk.white(
        `📍 监控路线: ${newTask.watch[0].from} → ${newTask.watch[0].to}`
      )
    );
    console.log(chalk.white(`📅 出行日期: ${newTask.watch[0].date}`));
    if (newTask.notifications && newTask.notifications.length > 0) {
      console.log(
        chalk.white(
          `📲 推送配置: ${newTask.notifications.map((n) => n.type).join(", ")}`
        )
      );
    }
  }

  // 询问是否继续编辑
  const { continueEdit } = await promptWithChinese([
    {
      type: "confirm",
      name: "continueEdit",
      message: "是否继续编辑配置?",
      default: true,
    },
  ]);

  if (continueEdit) {
    await editConfig();
  }
}

// 修改监控任务
async function editMonitorTask(config) {
  if (!config.watch || config.watch.length === 0) {
    console.log(chalk.yellow("暂无监控任务"));
    return;
  }

  const { taskIndex } = await promptWithChinese([
    {
      type: "list",
      name: "taskIndex",
      message: "选择要修改的监控任务:",
      choices: config.watch.map((watch, index) => ({
        name: `${index + 1}. ${watch.from} → ${watch.to} (${watch.date})`,
        value: index,
      })),
    },
  ]);

  const task = config.watch[taskIndex];
  const { editField } = await promptWithChinese([
    {
      type: "list",
      name: "editField",
      message: "选择要修改的内容:",
      choices: [
        { name: "📅 修改日期", value: "date" },
        { name: "🚄 修改车次配置", value: "trains" },
        { name: "🎫 修改席别配置", value: "seats" },
        { name: "🔄 重新配置整个任务", value: "recreate" },
      ],
    },
  ]);

  switch (editField) {
    case "date":
      const { newDate } = await promptWithChinese([
        {
          name: "newDate",
          message: "请输入新的日期(YYYYMMDD):",
          default: task.date,
          validate: (v) =>
            /^\d{8}$/.test(v) ? true : "格式错误，请输入8位数字",
        },
      ]);
      task.date = newDate;
      break;

    case "trains":
      // 重新查询和选择车次
      try {
        const fromCode = await ChinaRailway.getStationCode(task.from);
        const toCode = await ChinaRailway.getStationCode(task.to);
        const data = await ChinaRailway.checkTickets(
          task.date,
          fromCode,
          toCode
        );
        const trains = data.data.result.map((row) =>
          ChinaRailway.parseTrainInfo(row)
        );

        const { selectedTrains } = await promptWithChinese([
          {
            type: "checkbox",
            name: "selectedTrains",
            message: "重新选择要监控的车次:",
            choices: trains.map((t) => ({
              name: `${t.station_train_code} ${t.start_time}-${t.arrive_time}`,
              value: t,
              checked: task.trains?.some(
                (existing) => existing.code === t.station_train_code
              ),
            })),
            validate: (answer) =>
              answer.length > 0 ? true : "至少选择一个车次",
          },
        ]);

        task.trains = await Promise.all(
          selectedTrains.map(async (train) => ({
            code: train.station_train_code,
            from: await ChinaRailway.getStationName(
              train.from_station_telecode
            ),
            to: await ChinaRailway.getStationName(train.to_station_telecode),
            checkRoundTrip: false,
          }))
        );
      } catch (e) {
        console.log(chalk.red("查询车次失败:", e.message));
        return;
      }
      break;

    case "seats":
      if (!task.trains || task.trains.length === 0) {
        console.log(chalk.yellow("请先配置车次"));
        return;
      }

      for (const train of task.trains) {
        const { seatTypes } = await promptWithChinese([
          {
            type: "checkbox",
            name: "seatTypes",
            message: `配置车次 ${train.code} 的席别:`,
            choices: [
              {
                name: "商务座",
                value: "商务座",
                checked: train.seatCategory?.includes("商务座"),
              },
              {
                name: "特等座",
                value: "特等座",
                checked: train.seatCategory?.includes("特等座"),
              },
              {
                name: "一等座",
                value: "一等座",
                checked: train.seatCategory?.includes("一等座"),
              },
              {
                name: "二等座",
                value: "二等座",
                checked: train.seatCategory?.includes("二等座"),
              },
              {
                name: "软卧",
                value: "软卧",
                checked: train.seatCategory?.includes("软卧"),
              },
              {
                name: "硬卧",
                value: "硬卧",
                checked: train.seatCategory?.includes("硬卧"),
              },
              {
                name: "软座",
                value: "软座",
                checked: train.seatCategory?.includes("软座"),
              },
              {
                name: "硬座",
                value: "硬座",
                checked: train.seatCategory?.includes("硬座"),
              },
              {
                name: "无座",
                value: "无座",
                checked: train.seatCategory?.includes("无座"),
              },
            ],
          },
        ]);

        if (seatTypes.length > 0) {
          train.seatCategory = seatTypes;
        } else {
          delete train.seatCategory;
        }
      }
      break;

    case "recreate":
      console.log(chalk.cyan("重新配置任务，当前配置将被替换"));
      const newTask = await queryAndConfig(false);
      if (newTask && newTask.watch && newTask.watch[0]) {
        config.watch[taskIndex] = newTask.watch[0];
      }
      return;
  }

  fs.writeFileSync("config.yml", yaml.dump(config), "utf-8");
  console.log(chalk.green("✅ 监控任务已更新!"));

  // 询问是否继续编辑
  const { continueEdit } = await promptWithChinese([
    {
      type: "confirm",
      name: "continueEdit",
      message: "是否继续编辑配置?",
      default: true,
    },
  ]);

  if (continueEdit) {
    await editConfig();
  }
}

// 删除监控任务
async function deleteMonitorTask(config) {
  if (!config.watch || config.watch.length === 0) {
    console.log(chalk.yellow("暂无监控任务"));
    return;
  }

  const { taskIndex } = await promptWithChinese([
    {
      type: "list",
      name: "taskIndex",
      message: "选择要删除的监控任务:",
      choices: config.watch.map((watch, index) => ({
        name: `${index + 1}. ${watch.from} → ${watch.to} (${watch.date})`,
        value: index,
      })),
    },
  ]);

  const task = config.watch[taskIndex];
  const { confirmDelete } = await promptWithChinese([
    {
      type: "confirm",
      name: "confirmDelete",
      message: `确认删除任务 "${task.from} → ${task.to} (${task.date})" ?`,
      default: false,
    },
  ]);

  if (confirmDelete) {
    config.watch.splice(taskIndex, 1);
    fs.writeFileSync("config.yml", yaml.dump(config), "utf-8");
    console.log(chalk.green("✅ 监控任务已删除!"));
  } else {
    console.log(chalk.yellow("已取消删除"));
  }

  // 询问是否继续编辑
  const { continueEdit } = await promptWithChinese([
    {
      type: "confirm",
      name: "continueEdit",
      message: "是否继续编辑配置?",
      default: true,
    },
  ]);

  if (continueEdit) {
    await editConfig();
  }
}

// 修改推送配置
async function editNotificationConfig(config) {
  const { notifAction } = await promptWithChinese([
    {
      type: "list",
      name: "notifAction",
      message: "选择推送配置操作:",
      choices: [
        { name: "➕ 添加推送配置", value: "add" },
        { name: "✏️  修改推送配置", value: "edit" },
        { name: "🗑️  删除推送配置", value: "delete" },
        { name: "🧹 清空所有推送配置", value: "clear" },
      ],
    },
  ]);

  switch (notifAction) {
    case "add":
      const { notificationType } = await promptWithChinese([
        {
          type: "list",
          name: "notificationType",
          message: "选择推送方式:",
          choices: [
            { name: "飞书推送", value: "Lark" },
            { name: "Telegram推送", value: "Telegram" },
            { name: "企业微信推送", value: "WechatWork" },
            { name: "Bark推送", value: "Bark" },
            { name: "SMTP邮件推送", value: "SMTP" },
          ],
        },
      ]);

      let newNotification = { type: notificationType };

      if (notificationType === "Lark") {
        const { webhook } = await promptWithChinese([
          {
            name: "webhook",
            message: "请输入飞书机器人Webhook URL:",
            validate: (v) => (v.includes("feishu.cn") ? true : "URL格式错误"),
          },
        ]);
        newNotification.webhook = webhook;

        const { needSecret } = await promptWithChinese([
          {
            type: "confirm",
            name: "needSecret",
            message: "是否启用签名校验？（建议启用以提高安全性）",
            default: false,
          },
        ]);

        if (needSecret) {
          const { secret } = await promptWithChinese([
            {
              name: "secret",
              message: "请输入签名密钥（从飞书机器人安全设置中获取）:",
              validate: (v) => (v.trim() ? true : "密钥不能为空"),
            },
          ]);
          newNotification.secret = secret;
        }
      } else if (notificationType === "Telegram") {
        const { botToken, chatId } = await promptWithChinese([
          {
            name: "botToken",
            message: "请输入Telegram Bot Token:",
            validate: (v) => (v.includes(":") ? true : "格式错误"),
          },
          {
            name: "chatId",
            message: "请输入Chat ID:",
            validate: (v) => (v.trim() ? true : "不能为空"),
          },
        ]);
        newNotification.botToken = botToken;
        newNotification.chatId = chatId;
      } else if (notificationType === "WechatWork") {
        const { webhook } = await promptWithChinese([
          {
            name: "webhook",
            message: "请输入企业微信机器人Webhook URL:",
            validate: (v) =>
              v.includes("qyapi.weixin.qq.com") ? true : "URL格式错误",
          },
        ]);
        newNotification.webhook = webhook;
      } else if (notificationType === "Bark") {
        const barkConfig = await promptWithChinese([
          {
            name: "deviceKey",
            message: "请输入Bark设备密钥(Device Key):",
            validate: (v) => (v.trim() ? true : "设备密钥不能为空"),
          },
          {
            name: "serverUrl",
            message: "请输入Bark服务器地址(默认: https://api.day.app):",
            default: "https://api.day.app",
          },
          {
            name: "group",
            message: "推送分组名称(可选):",
            default: "火车票监控",
          },
          {
            name: "sound",
            message: "推送声音(可选, 默认: default):",
            default: "default",
          },
        ]);

        // 询问是否配置高级选项
        const { useAdvanced } = await promptWithChinese([
          {
            type: "confirm",
            name: "useAdvanced",
            message: "是否配置高级选项(推送级别、图标等)?",
            default: false,
          },
        ]);

        if (useAdvanced) {
          const advancedConfig = await promptWithChinese([
            {
              type: "list",
              name: "level",
              message: "推送级别:",
              choices: [
                { name: "默认(active)", value: "active" },
                { name: "重要警告(critical)", value: "critical" },
                { name: "时效性通知(timeSensitive)", value: "timeSensitive" },
                { name: "仅添加到列表(passive)", value: "passive" },
              ],
              default: "active",
            },
            {
              name: "icon",
              message: "自定义图标URL(可选):",
            },
            {
              name: "url",
              message: "点击跳转URL(可选):",
            },
            {
              type: "confirm",
              name: "autoCopy",
              message: "自动复制推送内容?",
              default: false,
            },
            {
              type: "confirm",
              name: "isArchive",
              message: "保存推送到历史记录?",
              default: true,
            },
          ]);

          Object.assign(barkConfig, advancedConfig);
        }

        Object.assign(newNotification, barkConfig);
      } else if (notificationType === "SMTP") {
        console.log(chalk.cyan("配置SMTP邮件推送:"));

        const smtpConfig = await promptWithChinese([
          {
            name: "host",
            message: "SMTP服务器地址(如: smtp.gmail.com):",
            validate: (v) => (v.trim() ? true : "SMTP服务器地址不能为空"),
          },
          {
            type: "number",
            name: "port",
            message: "SMTP端口号(常用: 587-STARTTLS, 465-SSL, 25-无加密):",
            default: 587,
            validate: (v) =>
              v > 0 && v <= 65535 ? true : "端口号必须在1-65535之间",
          },
          {
            name: "user",
            message: "邮箱用户名:",
            validate: (v) => (v.trim() ? true : "邮箱用户名不能为空"),
          },
          {
            type: "password",
            name: "pass",
            message: "邮箱密码或应用密码:",
            validate: (v) => (v.trim() ? true : "密码不能为空"),
          },
          {
            name: "from",
            message: "发件人显示名称(可选, 默认使用用户名):",
          },
          {
            name: "to",
            message: "收件人邮箱地址:",
            validate: (v) => {
              const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
              return emailRegex.test(v.trim()) ? true : "请输入有效的邮箱地址";
            },
          },
        ]);

        // 询问是否配置高级选项
        const { useAdvancedSMTP } = await promptWithChinese([
          {
            type: "confirm",
            name: "useAdvancedSMTP",
            message: "是否配置高级选项(安全连接、抄送等)?",
            default: false,
          },
        ]);

        if (useAdvancedSMTP) {
          const advancedSMTPConfig = await promptWithChinese([
            {
              type: "list",
              name: "secure",
              message: "安全连接类型:",
              choices: [
                { name: "自动检测(推荐)", value: undefined },
                { name: "SSL/TLS (端口465)", value: true },
                { name: "STARTTLS (端口587)", value: false },
              ],
              default: undefined,
            },
            {
              name: "cc",
              message: "抄送邮箱(多个用逗号分隔, 可选):",
            },
            {
              name: "bcc",
              message: "密送邮箱(多个用逗号分隔, 可选):",
            },
            {
              name: "replyTo",
              message: "回复邮箱(可选):",
            },
          ]);

          Object.assign(smtpConfig, advancedSMTPConfig);
        }

        Object.assign(newNotification, smtpConfig);
      }

      if (!config.notifications) config.notifications = [];
      config.notifications.push(newNotification);
      break;

    case "edit":
      if (!config.notifications || config.notifications.length === 0) {
        console.log(chalk.yellow("暂无推送配置"));
        return;
      }

      const { notifIndex } = await promptWithChinese([
        {
          type: "list",
          name: "notifIndex",
          message: "选择要修改的推送配置:",
          choices: config.notifications.map((notif, index) => ({
            name: `${index + 1}. ${notif.type}`,
            value: index,
          })),
        },
      ]);

      const notif = config.notifications[notifIndex];
      if (notif.type === "Lark") {
        const { webhook } = await promptWithChinese([
          {
            name: "webhook",
            message: "请输入新的Webhook URL:",
            default: notif.webhook,
            validate: (v) => (v.trim() ? true : "不能为空"),
          },
        ]);
        notif.webhook = webhook;

        // 询问签名校验配置
        const currentHasSecret = notif.secret ? true : false;
        const { secretAction } = await promptWithChinese([
          {
            type: "list",
            name: "secretAction",
            message: "签名校验配置:",
            choices: [
              {
                name: currentHasSecret ? "保持当前签名密钥" : "不启用签名校验",
                value: "keep",
              },
              {
                name: currentHasSecret ? "修改签名密钥" : "启用签名校验",
                value: "edit",
              },
              ...(currentHasSecret
                ? [{ name: "删除签名密钥", value: "remove" }]
                : []),
            ],
          },
        ]);

        if (secretAction === "edit") {
          const { secret } = await promptWithChinese([
            {
              name: "secret",
              message: "请输入签名密钥:",
              default: notif.secret || "",
              validate: (v) => (v.trim() ? true : "密钥不能为空"),
            },
          ]);
          notif.secret = secret;
        } else if (secretAction === "remove") {
          delete notif.secret;
        }
      } else if (notif.type === "WechatWork") {
        const { webhook } = await promptWithChinese([
          {
            name: "webhook",
            message: "请输入新的Webhook URL:",
            default: notif.webhook,
            validate: (v) => (v.trim() ? true : "不能为空"),
          },
        ]);
        notif.webhook = webhook;
      } else if (notif.type === "Telegram") {
        const { botToken, chatId } = await promptWithChinese([
          {
            name: "botToken",
            message: "请输入新的Bot Token:",
            default: notif.botToken,
            validate: (v) => (v.includes(":") ? true : "格式错误"),
          },
          {
            name: "chatId",
            message: "请输入新的Chat ID:",
            default: notif.chatId,
            validate: (v) => (v.trim() ? true : "不能为空"),
          },
        ]);
        notif.botToken = botToken;
        notif.chatId = chatId;
      } else if (notif.type === "Bark") {
        console.log(chalk.cyan("当前Bark配置:"));
        console.log(`  设备密钥: ${notif.deviceKey}`);
        console.log(`  服务器: ${notif.serverUrl || "https://api.day.app"}`);
        console.log(`  分组: ${notif.group || "未设置"}`);
        console.log(`  声音: ${notif.sound || "default"}`);

        const barkEditConfig = await promptWithChinese([
          {
            name: "deviceKey",
            message: "设备密钥(Device Key):",
            default: notif.deviceKey,
            validate: (v) => (v.trim() ? true : "设备密钥不能为空"),
          },
          {
            name: "serverUrl",
            message: "服务器地址:",
            default: notif.serverUrl || "https://api.day.app",
          },
          {
            name: "group",
            message: "推送分组:",
            default: notif.group || "火车票监控",
          },
          {
            name: "sound",
            message: "推送声音:",
            default: notif.sound || "default",
          },
        ]);

        // 询问是否修改高级选项
        const { editAdvanced } = await promptWithChinese([
          {
            type: "confirm",
            name: "editAdvanced",
            message: "是否修改高级选项?",
            default: false,
          },
        ]);

        if (editAdvanced) {
          const advancedEditConfig = await promptWithChinese([
            {
              type: "list",
              name: "level",
              message: "推送级别:",
              choices: [
                { name: "默认(active)", value: "active" },
                { name: "重要警告(critical)", value: "critical" },
                { name: "时效性通知(timeSensitive)", value: "timeSensitive" },
                { name: "仅添加到列表(passive)", value: "passive" },
              ],
              default: notif.level || "active",
            },
            {
              name: "icon",
              message: "自定义图标URL:",
              default: notif.icon || "",
            },
            {
              name: "url",
              message: "点击跳转URL:",
              default: notif.url || "",
            },
            {
              type: "confirm",
              name: "autoCopy",
              message: "自动复制推送内容?",
              default: notif.autoCopy || false,
            },
            {
              type: "confirm",
              name: "isArchive",
              message: "保存推送到历史记录?",
              default: notif.isArchive !== undefined ? notif.isArchive : true,
            },
          ]);

          Object.assign(barkEditConfig, advancedEditConfig);
        }

        Object.assign(notif, barkEditConfig);
      } else if (notif.type === "SMTP") {
        console.log(chalk.cyan("当前SMTP配置:"));
        console.log(`  服务器: ${notif.host}:${notif.port}`);
        console.log(`  用户名: ${notif.user}`);
        console.log(`  收件人: ${notif.to}`);
        if (notif.from) console.log(`  发件人: ${notif.from}`);
        if (notif.cc) console.log(`  抄送: ${notif.cc}`);

        const smtpEditConfig = await promptWithChinese([
          {
            name: "host",
            message: "SMTP服务器地址:",
            default: notif.host,
            validate: (v) => (v.trim() ? true : "SMTP服务器地址不能为空"),
          },
          {
            type: "number",
            name: "port",
            message: "SMTP端口号:",
            default: notif.port,
            validate: (v) =>
              v > 0 && v <= 65535 ? true : "端口号必须在1-65535之间",
          },
          {
            name: "user",
            message: "邮箱用户名:",
            default: notif.user,
            validate: (v) => (v.trim() ? true : "邮箱用户名不能为空"),
          },
          {
            type: "password",
            name: "pass",
            message: "邮箱密码或应用密码:",
            default: notif.pass,
            validate: (v) => (v.trim() ? true : "密码不能为空"),
          },
          {
            name: "from",
            message: "发件人显示名称:",
            default: notif.from || "",
          },
          {
            name: "to",
            message: "收件人邮箱地址:",
            default: notif.to,
            validate: (v) => {
              const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
              return emailRegex.test(v.trim()) ? true : "请输入有效的邮箱地址";
            },
          },
        ]);

        // 询问是否修改高级选项
        const { editAdvancedSMTP } = await promptWithChinese([
          {
            type: "confirm",
            name: "editAdvancedSMTP",
            message: "是否修改高级选项?",
            default: false,
          },
        ]);

        if (editAdvancedSMTP) {
          const advancedSMTPEditConfig = await promptWithChinese([
            {
              type: "list",
              name: "secure",
              message: "安全连接类型:",
              choices: [
                { name: "自动检测(推荐)", value: undefined },
                { name: "SSL/TLS (端口465)", value: true },
                { name: "STARTTLS (端口587)", value: false },
              ],
              default: notif.secure,
            },
            {
              name: "cc",
              message: "抄送邮箱:",
              default: notif.cc || "",
            },
            {
              name: "bcc",
              message: "密送邮箱:",
              default: notif.bcc || "",
            },
            {
              name: "replyTo",
              message: "回复邮箱:",
              default: notif.replyTo || "",
            },
          ]);

          Object.assign(smtpEditConfig, advancedSMTPEditConfig);
        }

        Object.assign(notif, smtpEditConfig);
      }
      break;

    case "delete":
      if (!config.notifications || config.notifications.length === 0) {
        console.log(chalk.yellow("暂无推送配置"));
        return;
      }

      const { delNotifIndex } = await promptWithChinese([
        {
          type: "list",
          name: "delNotifIndex",
          message: "选择要删除的推送配置:",
          choices: config.notifications.map((notif, index) => ({
            name: `${index + 1}. ${notif.type}`,
            value: index,
          })),
        },
      ]);

      config.notifications.splice(delNotifIndex, 1);
      break;

    case "clear":
      const { confirmClear } = await promptWithChinese([
        {
          type: "confirm",
          name: "confirmClear",
          message: "确认清空所有推送配置?",
          default: false,
        },
      ]);

      if (confirmClear) {
        config.notifications = [];
      }
      break;
  }

  fs.writeFileSync("config.yml", yaml.dump(config), "utf-8");
  console.log(chalk.green("✅ 推送配置已更新!"));

  // 询问是否继续编辑
  const { continueEdit } = await promptWithChinese([
    {
      type: "confirm",
      name: "continueEdit",
      message: "是否继续编辑配置?",
      default: true,
    },
  ]);

  if (continueEdit) {
    await editConfig();
  }
}

// 修改查询参数
async function editQueryParams(config) {
  const { interval, delay } = await promptWithChinese([
    {
      type: "number",
      name: "interval",
      message: "查询间隔(分钟):",
      default: config.interval || 15,
      validate: (v) => (v > 0 ? true : "必须大于0"),
    },
    {
      type: "number",
      name: "delay",
      message: "访问延迟(秒):",
      default: config.delay || 5,
      validate: (v) => (v >= 0 ? true : "必须大于等于0"),
    },
  ]);

  config.interval = interval;
  config.delay = delay;

  fs.writeFileSync("config.yml", yaml.dump(config), "utf-8");
  console.log(chalk.green("✅ 查询参数已更新!"));

  // 询问是否继续编辑
  const { continueEdit } = await promptWithChinese([
    {
      type: "confirm",
      name: "continueEdit",
      message: "是否继续编辑配置?",
      default: true,
    },
  ]);

  if (continueEdit) {
    await editConfig();
  }
}

// 重置配置
async function resetConfig() {
  const { confirmReset } = await promptWithChinese([
    {
      type: "confirm",
      name: "confirmReset",
      message: "⚠️  确认重置全部配置? 当前配置将被完全清除!",
      default: false,
    },
  ]);

  if (confirmReset) {
    fs.unlinkSync("config.yml");
    console.log(chalk.green("✅ 配置已重置! 请重新配置监控任务"));

    // 重置后询问是否立即配置
    const { startConfig } = await promptWithChinese([
      {
        type: "confirm",
        name: "startConfig",
        message: "是否立即重新配置监控任务?",
        default: true,
      },
    ]);

    if (startConfig) {
      await queryAndConfig();
    }
  } else {
    console.log(chalk.yellow("已取消重置"));

    // 询问是否继续编辑
    const { continueEdit } = await promptWithChinese([
      {
        type: "confirm",
        name: "continueEdit",
        message: "是否继续编辑配置?",
        default: true,
      },
    ]);

    if (continueEdit) {
      await editConfig();
    }
  }
}

async function viewConfig() {
  try {
    const configContent = fs.readFileSync("config.yml", "utf-8");
    const config = yaml.load(configContent);

    console.log(chalk.blue("\n📋 当前配置文件内容:\n"));
    console.log(chalk.white(yaml.dump(config)));

    console.log(chalk.green("\n✅ 配置摘要:"));
    config.watch.forEach((watch, index) => {
      console.log(
        chalk.cyan(
          `监控任务 ${index + 1}: ${watch.from} → ${watch.to} (${watch.date})`
        )
      );
      if (watch.trains) {
        console.log(
          chalk.white(`  车次: ${watch.trains.map((t) => t.code).join(", ")}`)
        );
      }
    });

    if (config.notifications && config.notifications.length > 0) {
      console.log(
        chalk.cyan(
          `推送配置: ${config.notifications.map((n) => n.type).join(", ")}`
        )
      );
    }

    // 询问后续操作
    const { nextAction } = await promptWithChinese([
      {
        type: "list",
        name: "nextAction",
        message: "接下来要做什么?",
        choices: [
          { name: "⚙️  编辑配置", value: "edit" },
          { name: "🚀 启动监控", value: "start" },
          { name: "🔙 返回主菜单", value: "back" },
        ],
      },
    ]);

    switch (nextAction) {
      case "edit":
        await editConfig();
        break;
      case "start":
        await startMonitoring();
        break;
      case "back":
        console.log(chalk.cyan("返回主菜单"));
        break;
    }
  } catch (err) {
    console.log(chalk.red("配置文件不存在或格式错误"));

    // 配置不存在时询问是否创建
    const { createConfig } = await promptWithChinese([
      {
        type: "confirm",
        name: "createConfig",
        message: "是否立即创建配置?",
        default: true,
      },
    ]);

    if (createConfig) {
      await queryAndConfig();
    }
  }
}

async function startMonitoring() {
  try {
    fs.accessSync("config.yml");
    console.log(chalk.green("\n🚀 正在启动监控程序...\n"));
    const { spawn } = await import("child_process");
    spawn("node", ["src/index.js"], { stdio: "inherit", cwd: process.cwd() });
  } catch (err) {
    console.log(chalk.red("配置文件不存在，请先配置监控任务"));
  }
}

main();
