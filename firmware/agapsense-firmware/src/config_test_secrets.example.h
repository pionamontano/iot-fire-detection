#pragma once
// ============================================================
// config_test_secrets.example.h — Template for test_components.cpp secrets
//
// Copy this file to config_test_secrets.h (already in .gitignore) and
// fill in real values. Never commit the real file — it holds your Wi-Fi
// password, a live Telegram bot token, and a personal phone number.
// ============================================================

#define TEST_WIFI_SSID      "your-wifi-ssid"       // 2.4GHz only — ESP32 can't join 5GHz networks
#define TEST_WIFI_PASSWORD  "your-wifi-password"

#define TEST_BOT_TOKEN      "your-telegram-bot-token"   // from @BotFather
#define TEST_CHAT_ID        "your-telegram-chat-id"      // message the bot once so it can reply to you

#define TEST_SMS_PHONE1     "+639XXXXXXXXX"
