const Node = {
  crypto: require('crypto'),
  http: require('http'),
  process: process
};

const LEV = require('./log-event.js');
const UUID4 = require('./uuid4.js');

LEV.HOST = '197.242.94.138';
LEV.PORT = 4444;

const NAMESPACE = 'fast-ml-api-adapter';

const HOST = '0.0.0.0';
const PORT = 3000;

// Preresolve TigerBeetle master IP address to avoid DNS overhead:
const TIGER_BEETLE_HOST = '10.126.12.35';
const TIGER_BEETLE_PORT = 80;

// Test harness payee:
const PAYEE_HOST = '10.126.10.139';
const PAYEE_PORT = 3333;

// Test harness payer:
const PAYER_HOST = '10.126.10.139';
const PAYER_PORT = 7777;

Node.process.on('uncaughtException',
  function(error) {
    LEV(`${NAMESPACE}: UNCAUGHT EXCEPTION: ${error}`);
  }
);

// Measure event loop blocks of 10ms or more within fast-ml-api-adapter:
(function() {
  const delay = 5;
  let time = Date.now();
  setInterval(
    function() {
      const start = time + delay;
      const end = Date.now();
      const delta = end - start;
      if (delta > 10) {
        LEV({
          start: start,
          end: end,
          label: `${NAMESPACE}: event loop blocked for ${delta}ms`
        });
      }
      time = end;
    },
    delay
  );
})();

const TigerBeetle = {};

TigerBeetle.CREATE_TRANSFERS = { jobs: [], timestamp: 0, timeout: 0 };
TigerBeetle.ACCEPT_TRANSFERS = { jobs: [], timestamp: 0, timeout: 0 };

TigerBeetle.create = function(request, callback) {
  const self = this;
  self.push(self.CREATE_TRANSFERS, request, callback);
};

TigerBeetle.accept = function(request, callback) {
  const self = this;
  self.push(self.ACCEPT_TRANSFERS, request, callback);
};

TigerBeetle.push = function(batch, request, callback) {
  const self = this;
  batch.jobs.push(new TigerBeetle.Job(request, callback));
  if (batch.timeout === 0) {
    batch.timestamp = Date.now();
    batch.timeout = setTimeout(
      function() {
        self.execute(batch);
      },
      50
    );
  }
};

TigerBeetle.execute = function(batch) {
  const ms = Date.now() - batch.timestamp;
  LEV(`batched ${batch.jobs.length} jobs in ${ms}ms`);
  batch.jobs.forEach(
    function(job) {
      job.callback();
    }
  );
  batch.jobs = [];
  batch.timestamp = 0;
  batch.timeout = 0;
};

TigerBeetle.Job = function(request, callback) {
  this.request = request;
  this.callback = callback;
};

function CreateServer() {
  const server = Node.http.createServer({},
    function(request, response) {
      const buffers = [];
      request.on('data', function(buffer) { buffers.push(buffer); });
      request.on('end',
        function() {
          if (request.url === '/transfers') {
            const buffer = Buffer.concat(buffers);
            const payload = JSON.parse(buffer.toString('ascii'));
            TigerBeetle.create(payload, function() {
              // Send prepare notification:
              PostNotification(PAYEE_HOST, PAYEE_PORT, '/transfers', buffer,
                function() {
                }
              );
              // ACK:
              response.statusCode = 202;
              response.end();
            });
          } else if (request.url.length > 36) {
            const buffer = Buffer.concat(buffers);
            const payload = JSON.parse(buffer.toString('ascii'));
            TigerBeetle.accept(payload, function() {
              // Send fulfill notification:
              const path = request.url;
              PostNotification(PAYER_HOST, PAYER_PORT, path, Buffer.from(JSON.stringify({ transferState: 'COMMITTED' })),
                function() {
                }
              );
              // ACK:
              response.statusCode = 202;
              response.end();
            });
          } else {
            console.log(`unknown request.url: ${request.url}`);
            response.end();
          }
        }
      );
    }
  );
  server.listen(PORT, HOST,
    function() {
      LEV(`${NAMESPACE}: Listening on ${HOST}:${PORT}...`);
    }
  );
}

function PostNotification(host, port, path, body, end) {
  const headers = {
    'Content-Length': body.length
  };
  const options = {
    method: 'POST',
    host: host,
    port: port,
    path: path,
    headers: headers
  };
  const request = Node.http.request(options,
    function(response) {
      const buffers = [];
      response.on('data', function(buffer) { buffers.push(buffer); });
      response.on('end',
        function() {
          end();
        }
      );
    }
  );
  request.write(body);
  request.end();
}

CreateServer();