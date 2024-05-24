const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const { createProxyMiddleware } = require("http-proxy-middleware");

const { services, origins } = {
  origins: process.env.ORIGINS ? JSON.parse(process.env.ORIGINS) : [],
  services: process.env.SERVICES ? JSON.parse(process.env.SERVICES) : [],
};

const app = express();

app.use(cors({ origin: origins, credentials: true }));
app.use(helmet());
app.use(morgan("combined"));
app.disable("x-powered-by");

console.log("Services configured:", services);
console.log("Origins configured:", origins);

const rateLimit = 20;
const interval = 60 * 1000;

const requestCounts = {};

setInterval(() => {
  Object.keys(requestCounts).forEach((ip) => {
    requestCounts[ip] = 0;
  });
}, interval);

function bypass(req, res, next) {
  req.header(`Access-Control-Allow-Origin`, "*");
  req.header(`Access-Control-Allow-Methods`, "*");
  req.header(`Access-Control-Allow-Headers`, "*");
  req.header(`ngrok-skip-browser-warning`, "ngrok-skip-browser-warning");
  res.header(`ngrok-skip-browser-warning`, "ngrok-skip-browser-warning");
  res.header(`Access-Control-Allow-Origin`, "*");
  res.header(`Access-Control-Allow-Methods`, "*");
  res.header(`Access-Control-Allow-Headers`, "*");
  next();
}

function logger(req, res, next) {
  console.log(`${req.method} ${req.originalUrl}`);
  console.log(`Request IP: ${req.ip}`);
  console.log(`Request headers: ${JSON.stringify(req.headers)}`);
  console.log(`Request body: ${JSON.stringify(req.body)}`);
  next();
}

function rateLimitAndTimeout(req, res, next) {
  const ip = req.ip;

  requestCounts[ip] = (requestCounts[ip] || 0) + 1;

  if (requestCounts[ip] > rateLimit) {
    return res.status(429).json({
      code: 429,
      status: "Error",
      message: "Rate limit exceeded.",
      data: null,
    });
  }

  req.setTimeout(15000, () => {
    res.status(504).json({
      code: 504,
      status: "Error",
      message: "Gateway timeout.",
      data: null,
    });
    req.abort();
  });

  next();
}

app.use(rateLimitAndTimeout);

services.forEach(({ route, target }) => {
  const proxyOptions = {
    target,
    changeOrigin: true,
    pathRewrite: {
      [`^${route}`]: "",
    },
  };

  app.use(
    route,
    bypass,
    logger,
    rateLimitAndTimeout,
    createProxyMiddleware(proxyOptions)
  );
});

app.use((_req, res) => {
  res.status(404).json({
    code: 404,
    status: "Error",
    message: "Route not found.",
    data: null,
  });
});

const PORT = process.env.PORT || 5050;

app.listen(PORT, () => {
  console.log(`Gateway is running on port ${PORT}`);
});
