require("dotenv").config();

const express = require("express");
const path = require("path");
const axios = require("axios");

const app = express();

const PORT = process.env.PORT || 3000;
const MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;

const CALLBACK_URL =
  process.env.CALLBACK_URL ||
  "https://mahshidshop.onrender.com/payment/callback";

const ZARINPAL_REQUEST =
  "https://api.zarinpal.com/pg/v4/payment/request.json";

const ZARINPAL_VERIFY =
  "https://api.zarinpal.com/pg/v4/payment/verify.json";

const ZARINPAL_STARTPAY =
  "https://www.zarinpal.com/pg/StartPay/";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// نمایش سایت
app.use(express.static(path.join(__dirname)));

// ===============================
// تست سلامت سرور
// ===============================
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "MahshidShop"
  });
});

// ===============================
// پیدا کردن IP خروجی Render
// ===============================
app.get("/my-ip", async (req, res) => {
  try {
    const response = await axios.get("https://api.ipify.org?format=json", {
      timeout: 10000
    });

    res.json({
      success: true,
      ip: response.data.ip
    });
  } catch (error) {
    console.error("❌ Could not detect public IP:");

    if (error.response) {
      console.error(error.response.data);
    } else {
      console.error(error.message);
    }

    res.status(500).json({
      success: false,
      message: "Could not detect public IP"
    });
  }
});

// ===============================
// درخواست پرداخت
// ===============================
const pendingPayments = new Map();

app.post("/api/payment", async (req, res) => {
  try {
    const { amount, name, phone, address, cart } = req.body;

    if (!amount || !name || !phone || !address) {
      return res.status(400).json({
        success: false,
        message: "اطلاعات سفارش کامل نیست."
      });
    }

    const amountToman = Number(amount);
    const amountRial = amountToman * 10;

    if (!Number.isFinite(amountRial) || amountRial <= 0) {
      return res.status(400).json({
        success: false,
        message: "مبلغ سفارش نامعتبر است."
      });
    }

    console.log("📤 Sending payment request...");
    console.log("Amount Toman:", amountToman);
    console.log("Amount Rial:", amountRial);
    console.log("Callback:", CALLBACK_URL);

    const paymentData = {
      merchant_id: MERCHANT_ID,
      amount: amountRial,
      callback_url: CALLBACK_URL,
      description: `سفارش فروشگاه ماهشید - ${name}`,
      metadata: {
        mobile: phone
      }
    };

    const response = await axios.post(
      ZARINPAL_REQUEST,
      paymentData,
      {
        headers: {
          "Content-Type": "application/json"
        },
        timeout: 20000
      }
    );

    console.log(
      "📥 ZarinPal response:",
      JSON.stringify(response.data, null, 2)
    );

    const data = response.data;

    if (
      data.data &&
      (data.data.code === 100 || data.data.code === 101) &&
      data.data.authority
    ) {
      const authority = data.data.authority;

      pendingPayments.set(authority, {
        amount: amountRial,
        name,
        phone,
        address,
        cart
      });

      const paymentUrl = ZARINPAL_STARTPAY + authority;

      return res.json({
        success: true,
        paymentUrl,
        authority
      });
    }

    return res.status(400).json({
      success: false,
      message:
        data.errors?.message ||
        "زرین‌پال درخواست پرداخت را قبول نکرد.",
      code: data.errors?.code || data.data?.code || null
    });

  } catch (error) {
    console.error("❌ Payment request failed:");

    if (error.response) {
      console.error(
        JSON.stringify(error.response.data, null, 2)
      );

      return res.status(500).json({
        success: false,
        message:
          error.response.data?.errors?.message ||
          "خطا از طرف زرین‌پال",
        code: error.response.data?.errors?.code || null
      });
    }

    console.error(error.message);

    return res.status(500).json({
      success: false,
      message: "خطا هنگام اتصال به زرین‌پال"
    });
  }
});

// ===============================
// بازگشت از زرین‌پال
// ===============================
app.get("/payment/callback", async (req, res) => {
  try {
    const authority = req.query.Authority;
    const status = req.query.Status;

    console.log("🔙 بازگشت از زرین‌پال");
    console.log("Status:", status);
    console.log("Authority:", authority);

    if (!authority) {
      return res.send(`
        <html dir="rtl">
          <head>
            <meta charset="UTF-8">
            <title>خطا</title>
          </head>
          <body>
            <h2>❌ اطلاعات پرداخت دریافت نشد.</h2>
          </body>
        </html>
      `);
    }

    if (status !== "OK") {
      return res.send(`
        <html dir="rtl">
          <head>
            <meta charset="UTF-8">
            <title>پرداخت</title>
          </head>
          <body>
            <h2>❌ پرداخت لغو یا ناموفق بود.</h2>
            <p>وضعیت: ${status || "نامشخص"}</p>
          </body>
        </html>
      `);
    }

    const payment = pendingPayments.get(authority);

    if (!payment) {
      return res.send(`
        <html dir="rtl">
          <head>
            <meta charset="UTF-8">
            <title>خطا</title>
          </head>
          <body>
            <h2>❌ اطلاعات سفارش پیدا نشد.</h2>
            <p>ممکن است سرور بعد از ایجاد پرداخت مجدداً راه‌اندازی شده باشد.</p>
          </body>
        </html>
      `);
    }

    console.log("🔍 Verifying payment...");

    const verifyResponse = await axios.post(
      ZARINPAL_VERIFY,
      {
        merchant_id: MERCHANT_ID,
        amount: payment.amount,
        authority: authority
      },
      {
        headers: {
          "Content-Type": "application/json"
        },
        timeout: 20000
      }
    );

    console.log(
      "📥 Verify response:",
      JSON.stringify(verifyResponse.data, null, 2)
    );

    const verifyData = verifyResponse.data;

    if (
      verifyData.data &&
      (verifyData.data.code === 100 ||
        verifyData.data.code === 101)
    ) {
      pendingPayments.delete(authority);

      return res.send(`
        <html dir="rtl">
          <head>
            <meta charset="UTF-8">
            <title>پرداخت موفق</title>
          </head>
          <body>
            <h2>✅ پرداخت با موفقیت انجام شد.</h2>
            <p>شماره تراکنش: ${
              verifyData.data.ref_id || "ثبت شد"
            }</p>
            <p>ممنون از خرید شما 🌹</p>
          </body>
        </html>
      `);
    }

    return res.send(`
      <html dir="rtl">
        <head>
          <meta charset="UTF-8">
          <title>پرداخت</title>
        </head>
        <body>
          <h2>❌ پرداخت تأیید نشد.</h2>
          <p>${
            verifyData.errors?.message ||
            "خطای نامشخص در تأیید پرداخت"
          }</p>
        </body>
      </html>
    `);

  } catch (error) {
    console.error("❌ Payment verification failed:");

    if (error.response) {
      console.error(
        JSON.stringify(error.response.data, null, 2)
      );
    } else {
      console.error(error.message);
    }

    return res.status(500).send(`
      <html dir="rtl">
        <head>
          <meta charset="UTF-8">
          <title>خطا</title>
        </head>
        <body>
          <h2>❌ خطا هنگام تأیید پرداخت</h2>
          <p>لطفاً دوباره تلاش کنید.</p>
        </body>
      </html>
    `);
  }
});

// ===============================
// شروع سرور
// ===============================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔗 Callback URL: ${CALLBACK_URL}`);
});