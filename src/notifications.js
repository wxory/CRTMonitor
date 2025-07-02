import { log, time, asset } from "./utils.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

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

  /**
   * 生成飞书签名校验
   * @param {number} timestamp 时间戳（秒）
   * @param {string} secret 密钥
   * @returns {string} 签名字符串
   */
  _generateSign(timestamp, secret) {
    const stringToSign = `${timestamp}\n${secret}`;
    const hmac = crypto.createHmac("sha256", stringToSign);
    return hmac.update("").digest("base64");
  }

  async send(msg) {
    // 构造飞书消息格式
    const larkMessage = {
      msg_type: "text",
      content: {
        text: typeof msg === "string" ? msg : JSON.stringify(msg, null, 2),
      },
    };

    // 如果配置了签名密钥，添加签名校验
    if (this.config.secret) {
      const timestamp = Math.floor(Date.now() / 1000);
      const sign = this._generateSign(timestamp, this.config.secret);

      larkMessage.timestamp = timestamp.toString();
      larkMessage.sign = sign;
    }

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
      description: config.chatId
        ? `Chat ID: ${config.chatId}`
        : "Telegram机器人",
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
      throw new Error(
        `Telegram推送 发送失败：${result.description || "未知错误"}`
      );
    }
  }
}

class WechatWorkNotification extends NotificationBase {
  constructor(config) {
    super(config, {
      name: "企业微信推送",
      description: config.webhook
        ? config.webhook.match(/key=([^&]+)/)?.[1]?.substring(0, 8) + "..."
        : "企业微信机器人",
    });
    if (!config.webhook) {
      throw new Error(`${this.info.name} 配置不完整：缺少 webhook 地址`);
    }
  }

  async send(msg) {
    // 构造企业微信消息格式
    const wechatMessage = {
      msgtype: "text",
      text: {
        content: typeof msg === "string" ? msg : JSON.stringify(msg, null, 2),
      },
    };

    const response = await fetch(this.config.webhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(wechatMessage),
    });

    if (!response.ok) {
      throw new Error(`企业微信推送 发送失败：HTTP ${response.status}`);
    }

    const result = await response.json();
    if (result.errcode !== 0) {
      throw new Error(`企业微信推送 发送失败：${result.errmsg || "未知错误"}`);
    }
  }
}

class BarkNotification extends NotificationBase {
  constructor(config) {
    super(config, {
      name: "Bark推送",
      description: config.deviceKey
        ? `设备: ${config.deviceKey.substring(0, 8)}...`
        : "Bark客户端",
    });
    if (!config.deviceKey) {
      throw new Error(`${this.info.name} 配置不完整：缺少 deviceKey`);
    }

    // 设置默认服务器地址
    this.serverUrl = config.serverUrl || "https://api.day.app";
  }

  async send(msg) {
    // 解析消息内容
    let title = "12306余票监控";
    let body = "";

    if (typeof msg === "string") {
      body = msg;
    } else if (msg && typeof msg === "object") {
      title = msg.title || title;
      body = msg.body || msg.content || JSON.stringify(msg, null, 2);
    }

    // 构造 Bark 推送参数
    const barkPayload = {
      device_key: this.config.deviceKey,
      title: title,
      body: body,
      group: this.config.group || "火车票监控",
      sound: this.config.sound || "default",
    };

    // 添加可选参数
    if (this.config.badge !== undefined) barkPayload.badge = this.config.badge;
    if (this.config.url) barkPayload.url = this.config.url;
    if (this.config.icon) barkPayload.icon = this.config.icon;
    if (this.config.level) barkPayload.level = this.config.level;
    if (this.config.volume !== undefined)
      barkPayload.volume = this.config.volume;
    if (this.config.copy) barkPayload.copy = this.config.copy;
    if (this.config.autoCopy) barkPayload.autoCopy = this.config.autoCopy;
    if (this.config.call) barkPayload.call = this.config.call;
    if (this.config.isArchive !== undefined)
      barkPayload.isArchive = this.config.isArchive;

    try {
      // 使用 POST JSON 方式发送
      const response = await fetch(`${this.serverUrl}/push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(barkPayload),
      });

      if (!response.ok) {
        throw new Error(`Bark推送 发送失败：HTTP ${response.status}`);
      }

      const result = await response.json();
      if (result.code !== 200) {
        throw new Error(`Bark推送 发送失败：${result.message || "未知错误"}`);
      }
    } catch (error) {
      // 如果 JSON 方式失败，尝试使用 URL 方式
      if (error.message.includes("HTTP")) {
        throw error;
      }

      try {
        const urlParams = new URLSearchParams();
        Object.entries(barkPayload).forEach(([key, value]) => {
          if (key !== "device_key" && value !== undefined) {
            urlParams.append(key, value.toString());
          }
        });

        const getUrl = `${this.serverUrl}/${
          this.config.deviceKey
        }/${encodeURIComponent(title)}/${encodeURIComponent(
          body
        )}?${urlParams.toString()}`;

        const fallbackResponse = await fetch(getUrl, { method: "GET" });
        if (!fallbackResponse.ok) {
          throw new Error(`Bark推送 发送失败：HTTP ${fallbackResponse.status}`);
        }
      } catch (fallbackError) {
        throw new Error(`Bark推送 发送失败：${fallbackError.message}`);
      }
    }
  }
}

class SMTPNotification extends NotificationBase {
  constructor(config) {
    super(config, {
      name: "SMTP邮件推送",
      description: config.to ? `发送至: ${config.to}` : "邮件推送",
    });

    // 验证必需配置
    if (
      !config.host ||
      !config.port ||
      !config.user ||
      !config.pass ||
      !config.to
    ) {
      throw new Error(`${this.info.name} 配置不完整：缺少必需的邮件配置`);
    }

    // 创建邮件传输器
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure !== undefined ? config.secure : config.port === 465,
      auth: {
        user: config.user,
        pass: config.pass,
      },
      // 可选配置
      ...(config.ignoreTLS && { ignoreTLS: true }),
      ...(config.requireTLS && { requireTLS: true }),
    });
  }

  async send(msg) {
    // 解析消息内容
    let subject = "🚄 12306余票监控通知";
    let text = "";
    let html = "";

    if (typeof msg === "string") {
      text = msg;
      html = `<div style="font-family: Arial, sans-serif; line-height: 1.6;">${msg.replace(
        /\n/g,
        "<br>"
      )}</div>`;
    } else if (msg && typeof msg === "object") {
      subject = msg.subject || msg.title || subject;
      text =
        msg.text || msg.body || msg.content || JSON.stringify(msg, null, 2);
      html =
        msg.html ||
        `<div style="font-family: Arial, sans-serif; line-height: 1.6;">${text.replace(
          /\n/g,
          "<br>"
        )}</div>`;
    }

    // 构造邮件选项
    const mailOptions = {
      from: this.config.from || this.config.user,
      to: this.config.to,
      subject: subject,
      text: text,
      html: html,
    };

    // 添加可选配置
    if (this.config.cc) mailOptions.cc = this.config.cc;
    if (this.config.bcc) mailOptions.bcc = this.config.bcc;
    if (this.config.replyTo) mailOptions.replyTo = this.config.replyTo;

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`邮件发送成功: ${info.messageId}`);
      return info;
    } catch (error) {
      throw new Error(`SMTP邮件推送 发送失败：${error.message}`);
    }
  }

  die() {
    if (this.transporter) {
      this.transporter.close();
    }
  }
}

export const Notifications = {
  Lark: LarkNotification,
  Telegram: TelegramNotification,
  WechatWork: WechatWorkNotification,
  Bark: BarkNotification,
  SMTP: SMTPNotification,
};
