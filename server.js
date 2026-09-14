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

const ZARINPAL_REQUEST_URL =
    "https://api.zarinpal.com/pg/v4/payment/request.json";

const ZARINPAL_VERIFY_URL =
    "https://api.zarinpal.com/pg/v4/payment/verify.json";

const ZARINPAL_STARTPAY_URL =
    "https://www.zarinpal.com/pg/StartPay/";

if (!MERCHANT_ID) {
    console.error("❌ ZARINPAL_MERCHANT_ID تنظیم نشده است.");
    process.exit(1);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// فایل‌های سایت
app.use(express.static(path.join(__dirname)));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// -----------------------------
// ساخت درخواست پرداخت
// -----------------------------
app.post("/api/payment", async (req, res) => {
    try {
        const {
            amount,
            name,
            phone,
            address,
            cart
        } = req.body;

        if (!amount || Number(amount) <= 0) {
            return res.status(400).json({
                success: false,
                message: "مبلغ سفارش نامعتبر است."
            });
        }

        if (!name || !phone || !address) {
            return res.status(400).json({
                success: false,
                message: "نام، موبایل و آدرس را کامل وارد کنید."
            });
        }

        /*
          سایت مبلغ را به تومان دارد.
          زرین‌پال API مبلغ را به ریال می‌گیرد.
        */
        const amountToman = Number(amount);
        const amountRial = amountToman * 10;

        const requestData = {
            merchant_id: MERCHANT_ID,
            amount: amountRial,
            callback_url: CALLBACK_URL,
            description: `سفارش فروشگاه ماهشید - ${name}`,
            metadata: {
                mobile: phone
            }
        };

        console.log("📤 Sending payment request...");
        console.log("Amount Toman:", amountToman);
        console.log("Amount Rial:", amountRial);
        console.log("Callback:", CALLBACK_URL);

        const response = await axios.post(
            ZARINPAL_REQUEST_URL,
            requestData,
            {
                headers: {
                    "Content-Type": "application/json"
                },
                timeout: 20000
            }
        );

        const result = response.data;

        console.log("📥 ZarinPal response:");
        console.log(JSON.stringify(result, null, 2));

        if (
            result &&
            result.data &&
            result.data.code === 100 &&
            result.data.authority
        ) {
            const authority = result.data.authority;

            /*
              برای Verify بعداً باید مبلغ تراکنش را داشته باشیم.
              فعلاً برای تست، اطلاعات تراکنش را در حافظه نگه می‌داریم.
            */
            pendingPayments.set(authority, {
                amountRial,
                amountToman,
                name,
                phone,
                address,
                cart,
                createdAt: Date.now()
            });

            const paymentUrl =
                ZARINPAL_STARTPAY_URL + authority;

            console.log("✅ Authority:", authority);
            console.log("🔗 Payment URL:", paymentUrl);

            return res.json({
                success: true,
                authority,
                paymentUrl
            });
        }

        const errorMessage =
            result?.errors?.message ||
            "زرین‌پال درخواست پرداخت را قبول نکرد.";

        const errorCode =
            result?.errors?.code ?? "unknown";

        console.error(
            "❌ ZarinPal Error:",
            errorCode,
            errorMessage
        );

        return res.status(400).json({
            success: false,
            message: errorMessage,
            code: errorCode,
            details: result
        });

    } catch (error) {

        console.error("❌ Payment request failed:");

        if (error.response) {
            console.error(
                JSON.stringify(error.response.data, null, 2)
            );
        } else {
            console.error(error.message);
        }

        return res.status(500).json({
            success: false,
            message: "خطا هنگام اتصال به زرین‌پال.",
            error:
                error.response?.data ||
                error.message
        });
    }
});

// پرداخت‌های در انتظار Verify
const pendingPayments = new Map();

// -----------------------------
// Callback زرین‌پال
// -----------------------------
app.get("/payment/callback", async (req, res) => {

    try {

        const {
            Authority,
            Status
        } = req.query;

        console.log("=================================");
        console.log("🔙 ZarinPal Callback");
        console.log("Status:", Status);
        console.log("Authority:", Authority);
        console.log("=================================");

        // پرداخت لغو شده
        if (Status !== "OK" || !Authority) {

            return res.send(`
                <!DOCTYPE html>
                <html lang="fa" dir="rtl">

                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport"
                          content="width=device-width, initial-scale=1.0">

                    <title>پرداخت ناموفق</title>

                    <style>
                        body {
                            font-family: Tahoma, Arial;
                            background: #f5f8f3;
                            text-align: center;
                            padding: 60px 20px;
                        }

                        .box {
                            max-width: 500px;
                            margin: auto;
                            background: white;
                            padding: 35px;
                            border-radius: 18px;
                            box-shadow: 0 5px 20px rgba(0,0,0,.1);
                        }

                        h1 {
                            color: #c62828;
                        }

                        a {
                            display: inline-block;
                            margin-top: 20px;
                            padding: 12px 25px;
                            background: #2e7d32;
                            color: white;
                            text-decoration: none;
                            border-radius: 10px;
                        }
                    </style>
                </head>

                <body>

                    <div class="box">

                        <h1>❌ پرداخت انجام نشد</h1>

                        <p>
                            پرداخت لغو شد یا تراکنش موفق نبود.
                        </p>

                        <a href="/">
                            بازگشت به فروشگاه
                        </a>

                    </div>

                </body>
                </html>
            `);
        }

        const payment =
            pendingPayments.get(Authority);

        if (!payment) {

            console.error(
                "❌ Payment not found for Authority:",
                Authority
            );

            return res.status(400).send(`
                <div style="
                    font-family:Tahoma;
                    direction:rtl;
                    text-align:center;
                    padding:50px;
                ">

                    <h2>❌ اطلاعات تراکنش پیدا نشد</h2>

                    <p>
                        لطفاً با پشتیبانی تماس بگیرید.
                    </p>

                    <a href="/">
                        بازگشت به فروشگاه
                    </a>

                </div>
            `);
        }

        // -----------------------------
        // Verify
        // -----------------------------

        const verifyData = {

            merchant_id: MERCHANT_ID,

            amount: payment.amountRial,

            authority: Authority

        };

        console.log("🔍 Verifying payment...");

        const verifyResponse = await axios.post(
            ZARINPAL_VERIFY_URL,
            verifyData,
            {
                headers: {
                    "Content-Type": "application/json"
                },
                timeout: 20000
            }
        );

        const verifyResult =
            verifyResponse.data;

        console.log("📥 Verify response:");

        console.log(
            JSON.stringify(
                verifyResult,
                null,
                2
            )
        );

        const verifyCode =
            verifyResult?.data?.code;

        // پرداخت موفق
        if (
            verifyCode === 100 ||
            verifyCode === 101
        ) {

            const refId =
                verifyResult.data.ref_id;

            // حذف تراکنش از حافظه
            pendingPayments.delete(Authority);

            return res.send(`
                <!DOCTYPE html>

                <html lang="fa" dir="rtl">

                <head>

                    <meta charset="UTF-8">

                    <meta name="viewport"
                          content="width=device-width, initial-scale=1.0">

                    <title>پرداخت موفق</title>

                    <style>

                        body {
                            font-family: Tahoma, Arial;
                            background: #f5f8f3;
                            text-align: center;
                            padding: 60px 20px;
                        }

                        .box {
                            max-width: 550px;
                            margin: auto;
                            background: white;
                            padding: 35px;
                            border-radius: 18px;
                            box-shadow:
                                0 5px 20px rgba(0,0,0,.1);
                        }

                        h1 {
                            color: #2e7d32;
                        }

                        .ref {
                            background: #e8f5e9;
                            padding: 15px;
                            border-radius: 10px;
                            margin-top: 20px;
                            font-size: 18px;
                        }

                        a {
                            display: inline-block;
                            margin-top: 25px;
                            padding: 12px 25px;
                            background: #2e7d32;
                            color: white;
                            text-decoration: none;
                            border-radius: 10px;
                        }

                    </style>

                </head>

                <body>

                    <div class="box">

                        <h1>
                            ✅ پرداخت با موفقیت انجام شد
                        </h1>

                        <p>
                            سفارش شما با موفقیت پرداخت شد.
                        </p>

                        <div class="ref">

                            کد پیگیری:
                            <strong>
                                ${refId}
                            </strong>

                        </div>

                        <a href="/">
                            بازگشت به فروشگاه
                        </a>

                    </div>

                </body>

                </html>
            `);
        }

        console.error(
            "❌ Payment verification failed:",
            verifyResult
        );

        return res.send(`
            <!DOCTYPE html>

            <html lang="fa" dir="rtl">

            <head>

                <meta charset="UTF-8">

                <title>پرداخت ناموفق</title>

            </head>

            <body style="
                font-family:Tahoma;
                text-align:center;
                padding:60px;
            ">

                <h1>❌ پرداخت تأیید نشد</h1>

                <p>
                    کد پاسخ زرین‌پال:
                    ${verifyCode ?? "نامشخص"}
                </p>

                <a href="/">
                    بازگشت به فروشگاه
                </a>

            </body>

            </html>
        `);

    } catch (error) {

        console.error("❌ Callback/Verify error:");

        if (error.response) {

            console.error(
                JSON.stringify(
                    error.response.data,
                    null,
                    2
                )
            );

        } else {

            console.error(error.message);

        }

        return res.status(500).send(`
            <div style="
                font-family:Tahoma;
                direction:rtl;
                text-align:center;
                padding:50px;
            ">

                <h2>❌ خطا در بررسی پرداخت</h2>

                <p>
                    لطفاً لاگ سرور را بررسی کنید.
                </p>

            </div>
        `);
    }
});

// -----------------------------
// تست سرور
// -----------------------------

app.get("/health", (req, res) => {

    res.json({
        status: "ok",
        service: "MahshidShop"
    });

});

// -----------------------------
// Start
// -----------------------------

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `✅ Server running on port ${PORT}`
        );

        console.log(
            `🔗 Callback URL: ${CALLBACK_URL}`
        );

    }
);