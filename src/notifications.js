import { log, time, asset } from "./utils.js";

class NotificationBase {
  static info = {
    name: "CRTM Notification",
    description: "",
  };

  constructor(config, info) {
    this.info = info;
    this.config = config;
  }

  async send(msg) {
    console.log(msg);
  }

  die() {}
}

class LarkNotification extends NotificationBase {
  constructor(config) {
    super(config, {
      name: "飞书推送",
      description: config.webhook
        ? config.webhook.match(/^https?:\/\/(.+?)\/.*$/)[1]
        : "飞书机器人",
    });
    if (!config.webhook) {
      throw new Error(`${this.info.name} 配置不完整：缺少 webhook 地址`);
    }
  }

  async send(msg) {
    // 构造飞书消息格式
    const larkMessage = {
      msg_type: "text",
      content: {
        text: typeof msg === "string" ? msg : JSON.stringify(msg, null, 2),
      },
    };

    const response = await fetch(this.config.webhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(larkMessage),
    });

    if (!response.ok) {
      throw new Error(`飞书推送 发送失败：HTTP ${response.status}`);
    }

    const result = await response.json();
    if (result.code !== 0) {
      throw new Error(`飞书推送 发送失败：${result.msg || "未知错误"}`);
    }
  }
}

class TelegramNotification extends NotificationBase {
  constructor(config) {
    super(config, {
      name: "Telegram推送",
      description: config.chatId ? `Chat ID: ${config.chatId}` : "Telegram机器人",
    });
    if (!config.botToken || !config.chatId) {
      throw new Error(`${this.info.name} 配置不完整：缺少 botToken 或 chatId`);
    }
  }

  async send(msg) {
    const telegramApiUrl = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;

    const telegramMessage = {
      chat_id: this.config.chatId,
      text: typeof msg === "string" ? msg : JSON.stringify(msg, null, 2),
      parse_mode: "Markdown", // 支持Markdown格式
    };

    const response = await fetch(telegramApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(telegramMessage),
    });

    if (!response.ok) {
      throw new Error(`Telegram推送 发送失败：HTTP ${response.status}`);
    }

    const result = await response.json();
    if (!result.ok) {
      throw new Error(`Telegram推送 发送失败：${result.description || "未知错误"}`);
    }
  }
}

export const Notifications = {
  Lark: LarkNotification,
  Telegram: TelegramNotification,
};
