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

class HTTPNotification extends NotificationBase {
  constructor(config) {
    super(config, {
      name: "HTTP 推送",
      description: config.url.match(/^https?:\/\/(.+?)\/.*$/)[1],
    });
    if (!config.url) {
      throw new Error(`${this.info.name} 配置不完整`);
    }
  }

  async send(msg) {
    const response = await fetch(this.config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg),
    });

    if (!response.ok) {
      throw new Error(`HTTP 推送 发送失败：HTTP ${response.status}`);
    }
  }
}

export const Notifications = {
  HTTP: HTTPNotification,
};
