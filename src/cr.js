import moment from "moment";

class ChinaRailway {
  static ticketCache = new Map();
  static stationName;
  static stationCode;

  // 重试配置
  static retryConfig = {
    maxRetries: 3,
    retryDelay: 1000, // 1秒
    backoffMultiplier: 2, // 指数退避
  };

  // 缓存配置
  static cacheConfig = {
    ttl: 5 * 60 * 1000, // 5分钟过期时间
    maxSize: 1000, // 最大缓存条目数
    cleanupInterval: 10 * 60 * 1000, // 10分钟清理一次过期缓存
  };

  // 初始化定时清理
  static {
    // 定期清理过期缓存
    setInterval(() => {
      this.cleanExpiredCache();
    }, this.cacheConfig.cleanupInterval);
  }

  // 设置缓存
  static setCache(key, value) {
    const now = Date.now();

    // 如果缓存已满，清理最旧的条目
    if (this.ticketCache.size >= this.cacheConfig.maxSize) {
      const firstKey = this.ticketCache.keys().next().value;
      this.ticketCache.delete(firstKey);
    }

    this.ticketCache.set(key, {
      data: value,
      timestamp: now,
      expireAt: now + this.cacheConfig.ttl,
    });
  }

  // 获取缓存
  static getCache(key) {
    const cached = this.ticketCache.get(key);
    if (!cached) {
      return null;
    }

    const now = Date.now();
    if (now > cached.expireAt) {
      this.ticketCache.delete(key);
      return null;
    }

    return cached.data;
  }

  // 清理过期缓存
  static cleanExpiredCache() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, cached] of this.ticketCache.entries()) {
      if (now > cached.expireAt) {
        this.ticketCache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(
        `清理了 ${cleanedCount} 个过期缓存条目，当前缓存大小: ${this.ticketCache.size}`
      );
    }
  }

  // 清空缓存
  static clearTicketCache() {
    this.ticketCache.clear();
    console.log("已清空所有票务缓存");
  }

  // 获取缓存统计信息
  static getCacheStats() {
    const now = Date.now();
    let validCount = 0;
    let expiredCount = 0;

    for (const cached of this.ticketCache.values()) {
      if (now > cached.expireAt) {
        expiredCount++;
      } else {
        validCount++;
      }
    }

    return {
      total: this.ticketCache.size,
      valid: validCount,
      expired: expiredCount,
      maxSize: this.cacheConfig.maxSize,
      ttl: this.cacheConfig.ttl / 1000 + "秒",
    };
  }

  // 通用重试方法
  static async fetchWithRetry(
    url,
    options = {},
    retries = this.retryConfig.maxRetries
  ) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response;
    } catch (error) {
      if (retries > 0) {
        const delay =
          this.retryConfig.retryDelay *
          Math.pow(
            this.retryConfig.backoffMultiplier,
            this.retryConfig.maxRetries - retries
          );
        console.warn(
          `请求失败，${delay}ms后重试 (剩余重试次数: ${retries}):`,
          error.message
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.fetchWithRetry(url, options, retries - 1);
      }
      throw new Error(`网络请求失败: ${error.message}`);
    }
  }

  static async getStationName(code) {
    if (!this.stationName) {
      await this.getStationData();
    }
    return this.stationName[code];
  }

  static async getStationCode(name) {
    if (!this.stationCode) {
      await this.getStationData();
    }
    return this.stationCode[name];
  }

  static async getStationData() {
    let response = await this.fetchWithRetry(
      "https://kyfw.12306.cn/otn/resources/js/framework/station_name.js"
    );
    let stationList = (await response.text())
      .match(/(?<=').+(?=')/)[0]
      .split("@")
      .slice(1);

    this.stationCode = {};
    this.stationName = {};
    stationList.forEach((station) => {
      let details = station.split("|");
      this.stationCode[details[1]] = details[2];
      this.stationName[details[2]] = details[1];
    });
  }

  static async checkTickets(date, from, to, delay) {
    if (
      moment().isSameOrAfter(moment(date, "YYYYMMDD").add(1, "days")) ||
      moment().add(15, "days").isBefore(moment(date, "YYYYMMDD"))
    ) {
      throw new Error("日期需为0~15天内");
    }

    const cacheKey = date + from + to;
    const cachedData = this.getCache(cacheKey);
    if (cachedData) {
      console.log(`使用缓存数据: ${cacheKey}`);
      return cachedData;
    }

    if (delay) {
      await delay;
    }

    let api =
      "https://kyfw.12306.cn/otn/leftTicket/queryG?leftTicketDTO.train_date=" +
      moment(date, "YYYYMMDD").format("YYYY-MM-DD") +
      "&leftTicketDTO.from_station=" +
      from +
      "&leftTicketDTO.to_station=" +
      to +
      "&purpose_codes=ADULT";

    let res = await this.fetchWithRetry(api, {
      headers: {
        Cookie: "JSESSIONID=",
      },
    });

    let data = await res.json();
    if (!data || !data.status) {
      throw new Error("获取余票数据失败");
    }

    // 缓存数据
    this.setCache(cacheKey, data);
    console.log(`缓存新数据: ${cacheKey}`);

    return data;
  }

  static parseTrainInfo(str) {
    // Ref: https://kyfw.12306.cn/otn/resources/merged/queryLeftTicket_end_js.js
    let arr = str.split("|");
    let data = {
      secretStr: arr[0],
      buttonTextInfo: arr[1],
      train_no: arr[2],
      station_train_code: arr[3],
      start_station_telecode: arr[4],
      end_station_telecode: arr[5],
      from_station_telecode: arr[6],
      to_station_telecode: arr[7],
      start_time: arr[8],
      arrive_time: arr[9],
      lishi: arr[10],
      canWebBuy: arr[11],
      yp_info: arr[12],
      start_train_date: arr[13],
      train_seat_feature: arr[14],
      location_code: arr[15],
      from_station_no: arr[16],
      to_station_no: arr[17],
      is_support_card: arr[18],
      controlled_train_flag: arr[19],
      gg_num: arr[20],
      gr_num: arr[21],
      qt_num: arr[22],
      rw_num: arr[23],
      rz_num: arr[24],
      tz_num: arr[25],
      wz_num: arr[26],
      yb_num: arr[27],
      yw_num: arr[28],
      yz_num: arr[29],
      ze_num: arr[30],
      zy_num: arr[31],
      swz_num: arr[32],
      srrb_num: arr[33],
      yp_ex: arr[34],
      seat_types: arr[35],
      exchange_train_flag: arr[36],
      houbu_train_flag: arr[37],
      houbu_seat_limit: arr[38],
      yp_info_new: arr[39],
      dw_flag: arr[46],
      stopcheckTime: arr[48],
      country_flag: arr[49],
      local_arrive_time: arr[50],
      local_start_time: arr[51],
      bed_level_info: arr[53],
      seat_discount_info: arr[54],
      sale_time: arr[55],
    };
    data.tickets = {
      优选一等座: data.gg_num,
      高级软卧: data.gr_num,
      其他: data.qt_num,
      软卧: data.rw_num,
      软座: data.rz_num,
      特等座: data.tz_num,
      无座: data.wz_num,
      YB: data.yb_num /* ? */,
      硬卧: data.yw_num,
      硬座: data.yz_num,
      二等座: data.ze_num,
      一等座: data.zy_num,
      商务座: data.swz_num,
      SRRB: data.srrb_num /* ? */,
    };
    return data;
  }
}

export default ChinaRailway;
