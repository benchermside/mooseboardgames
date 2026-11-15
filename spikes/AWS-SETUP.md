# AWS setup and runs for the Phase 0 spikes

These steps create everything the spikes need in **us-east-1**, run S2, S4, and S1, and tell you what to record. When you're done, follow [AWS-CLEANUP.md](AWS-CLEANUP.md).

- **Names.** Every resource is named `mbg-spike-...`, so it's easy to find and delete later.
- **Your account ID.** Wherever you see `ACCOUNT_ID`, use your 12-digit account ID. It's in the account menu at the top right of the console.
- **Where to run commands.** Run all commands from the **repo root** in PowerShell, unless a step says to `cd spikes`.
- **Cost.** Expect well under $1 if you clean up the same day. The only things billed by the hour are running tasks, at about 1.5¢/hour each including the public IP.
- **Console labels.** The AWS console changes its wording now and then. If a label doesn't match exactly, look for the closest equivalent. The values to enter are what matter.

Before starting, run S3 locally (see [README.md](README.md)). It needs no AWS.

---

## Step 0: Sign in and pick the region

1. Go to https://console.aws.amazon.com/ and sign in.
2. In the region menu at the top right, choose **US East (N. Virginia) us-east-1**. Use this region for every step, unless a step says otherwise.
3. **Optional but recommended: a budget alert.**
   1. Open **Billing and Cost Management → Budgets → Create budget**.
   2. Choose **Use a template → Monthly cost budget**.
   3. Name it `mbg-spike-budget`, set the amount to **$5**, and enter your email.
   4. Choose **Create budget**.

## Step 1: Build the image and push it to ECR

1. Create the repository:
   1. Open **Elastic Container Registry (ECR) → Private registry → Repositories → Create repository**.
   2. Set **Repository name** to `mbg-spike-game-server`. Leave the other settings as they are.
   3. Choose **Create**.
2. Make sure Docker Desktop is running, then in PowerShell at the repo root run these commands. Use your account ID in place of `ACCOUNT_ID`.
   ```powershell
   cd spikes; npm install; cd ..
   $repo = "ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/mbg-spike-game-server"
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin "ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com"
   docker buildx build --platform linux/arm64 --provenance=false -f spikes/server/Dockerfile -t "${repo}:alpine" --push .
   ```
   `docker login` should print **Login Succeeded**. The build takes about a minute.
3. In the console, open the `mbg-spike-game-server` repository. You should see an image tagged **alpine**.
   - Write down its **Image URI**.
   - Write down its **Size**, which you need for S4.

## Step 2: Check the default VPC and create the security group

1. Check that DNS hostnames are enabled:
   1. Open **VPC → Your VPCs** and select the VPC whose **Default VPC** column says **Yes** (`vpc-07ac0c876f326838b`).
   2. On its **Details** tab, check that **DNS hostnames** and **DNS resolution** both say **Enabled**.
   3. If either one doesn't, choose **Actions → Edit VPC settings**, tick both, and save.
2. Pick the subnets:
   1. Open **VPC → Subnets**, and filter by that VPC.
   2. Write down the **Subnet IDs** for **us-east-1a**, **us-east-1b**, and **us-east-1c**.
   3. Don't use **us-east-1e**. In your account it's AZ `use1-az3`, which doesn't support Fargate.
3. Create the security group:
   1. Open **VPC → Security groups → Create security group**.
   2. **Security group name:** `mbg-spike-task-sg`.
   3. **Description:** `Spike game tasks: CloudFront only on 8000`.
   4. **VPC:** the default VPC.
   5. Under **Inbound rules**, choose **Add rule**:
      - **Type:** Custom TCP.
      - **Port range:** `8000`.
      - **Source:** Custom. Click in the box, type `cloudfront`, and pick **com.amazonaws.global.cloudfront.origin-facing** (its ID starts with `pl-`).
   6. Leave **Outbound rules** as the default (all traffic).
   7. Choose **Create security group**, and write down its **Security group ID** (`sg-...`).

## Step 3: Create the log group, ECS cluster, and task definition

1. Create the log group first. That way the task doesn't need permission to create it.
   1. Open **CloudWatch → Logs → Log groups → Create log group**.
   2. **Name:** `/ecs/mbg-spike-game-server`. **Retention:** 1 day.
   3. Choose **Create**.
2. Create the cluster:
   1. Open **Elastic Container Service (ECS) → Clusters → Create cluster**.
   2. **Cluster name:** `mbg-spike`.
   3. **Infrastructure:** **AWS Fargate (serverless)** only.
   4. Leave **Monitoring (Container Insights)** off, because it costs extra.
   5. Choose **Create**, and wait for it to finish (about a minute).
3. Create the task definition. Open **ECS → Task definitions → Create new task definition** and choose the plain form, not JSON.
   1. Fill in the task settings:
      - **Task definition family:** `mbg-spike-game-server`.
      - **Launch type:** AWS Fargate.
      - **Operating system/Architecture:** **Linux/ARM64**.
      - **CPU:** .25 vCPU. **Memory:** .5 GB.
      - **Task role:** none.
      - **Task execution role:** **Create new role**. If `ecsTaskExecutionRole` already exists, pick it instead.
   2. Under **Container - 1**, fill in the container settings:
      - **Name:** `game-server`. This must match `containerName` in the config file.
      - **Image URI:** the URI from Step 1, ending in `:alpine`.
      - **Essential container:** Yes.
      - **Port mappings:** container port `8000`, protocol TCP.
      - **Environment variables:** add the key `SEAT_CREDENTIALS` with the value `{"0":"cred0","1":"cred1"}`.
      - **Logging:** **Use log collection** ticked, with Amazon CloudWatch. Make sure `awslogs-group` is `/ecs/mbg-spike-game-server` and `awslogs-region` is `us-east-1`. If there's an `awslogs-create-group` option, **remove it**, because the group already exists.
      - **Container timeouts → Stop timeout:** `30`.
   3. Choose **Create**.

## Step 4: Create the DynamoDB table

This table stands in for the match table. The launch script writes each task's address into it, and the router reads it.

1. Open **DynamoDB → Tables → Create table**.
2. **Table name:** `mbg-spike-matches`. **Partition key:** `matchID`, type **String**. No sort key.
3. Under **Table settings**, choose **Customize settings**, then set **Capacity mode** to **On-demand**.
4. Choose **Create table**.

## Step 5: Create the IAM role for the router

1. Open **IAM → Roles → Create role**.
2. **Trusted entity type:** **Custom trust policy**. Replace the text with the contents of [aws/router-trust-policy.json](aws/router-trust-policy.json). Choose **Next**.
3. Don't add any permissions on this page. Choose **Next**.
4. **Role name:** `mbg-spike-router-role`. Choose **Create role**.
5. Add its permissions:
   1. Open the new role, then choose **Add permissions → Create inline policy → JSON**.
   2. Paste the contents of [aws/router-permissions.json](aws/router-permissions.json), replacing **both** `ACCOUNT_ID`s with your account ID.
   3. Choose **Next**, name it `mbg-spike-router-access`, and choose **Create policy**.

## Step 6: Create the Lambda@Edge router

Lambda@Edge functions must be created in us-east-1.

1. Open **Lambda → Functions → Create function → Author from scratch**.
   - **Function name:** `mbg-spike-router`.
   - **Runtime:** **Node.js 26.x**. If CloudFront later rejects it, recreate the function with Node.js 20.x.
   - **Architecture:** **x86_64**. Lambda@Edge doesn't support arm64.
   - **Permissions:** expand **Change default execution role**, choose **Use an existing role**, and pick `mbg-spike-router-role`.
   - Choose **Create function**.
2. On the **Code** tab, open `index.mjs`. Replace all of its contents with [aws/router/index.mjs](aws/router/index.mjs), then choose **Deploy**.
3. Set the timeout:
   1. Open **Configuration → General configuration → Edit**.
   2. Set **Timeout** to 5 seconds and **Memory** to 128 MB.
   3. Choose **Save**.
4. Publish a version: choose **Actions → Publish new version**, then **Publish**. Write down the **version ARN**, which ends in `:1`. CloudFront needs a numbered version, not `$LATEST`.

If you change the router code later, deploy it again and publish a new version. Then update the CloudFront association (Step 7.3) to use the new version number.

## Step 7: Create the CloudFront distribution

1. Create the origin request policy. Its job is to forward the WebSocket handshake and the query string to the task.
   1. Open **CloudFront → Policies → Origin request → Create origin request policy**.
   2. **Name:** `mbg-spike-ws`.
   3. **Headers:** **Include the following headers**. Add these custom headers: `Sec-WebSocket-Key`, `Sec-WebSocket-Version`, `Sec-WebSocket-Protocol`, `Sec-WebSocket-Extensions`.
   4. **Query strings:** **All**. Socket.IO needs `EIO` and `transport`.
   5. **Cookies:** **None**.
   6. Choose **Create**.
2. Create the distribution:
   1. Open **CloudFront → Distributions → Create distribution**. If the console asks you to pick a plan, choose **Pay as you go**, not a flat-rate plan.
   2. Set up the origin. Choose an "other"/custom origin if asked.
      - **Origin domain:** `example.com`. This is a placeholder, because the router replaces it on every request.
      - **Protocol:** **HTTP only**. **HTTP port:** `8000`.
   3. Set up the **default cache behavior**:
      - **Viewer protocol policy:** Redirect HTTP to HTTPS.
      - **Allowed HTTP methods:** GET, HEAD.
      - **Cache policy:** **CachingDisabled**.
      - **Origin request policy:** **mbg-spike-ws**.
   4. Set the remaining settings:
      - **Web Application Firewall (WAF):** **Do not enable security protections**.
      - **Price class:** **Use only North America and Europe**.
      - Don't add an alternate domain name. The spike uses the `*.cloudfront.net` name.
   5. Choose **Create distribution**. Write down the **Distribution domain name** (`dXXXX.cloudfront.net`).
3. Attach the router:
   1. Open the distribution's **Behaviors** tab, select the default behavior, and choose **Edit**.
   2. Under **Function associations**, set **Origin request** to **Lambda@Edge**, with the **version ARN** from Step 6.
   3. Choose **Save changes**. If the console offers to update the function's role or trust, accept.
4. Stop CloudFront from caching errors. By default CloudFront remembers an error for 10 seconds, which would distort the startup timings.
   1. Open the distribution's **Error pages** tab and choose **Create custom error response**.
   2. **HTTP error code:** 502. **Error caching minimum TTL:** `0`. **Customize error response:** No.
   3. Choose **Create**.
   4. Repeat for **503**, **504**, and **404**.
5. Wait until **Last modified** shows a date instead of **Deploying**. This usually takes 3 to 10 minutes.
6. Check the router is working. In a browser, open `https://dXXXX.cloudfront.net/m/nothing/healthz`. You should get the text **No such match**, which comes from the router. If you get a CloudFront error page instead, the Lambda association didn't take.

## Step 8: Configure the scripts

```powershell
cd spikes
copy aws\config.example.json aws\config.json
notepad aws\config.json
```

Fill in the values you wrote down:
- `subnets`: the us-east-1a, us-east-1b, and us-east-1c subnet IDs.
- `securityGroup`: the `sg-...` ID.
- `cloudFrontDomain`: `dXXXX.cloudfront.net`, without `https://`.

The other values already match the names above. `config.json` is gitignored.

The scripts use your AWS CLI credentials. `aws sts get-caller-identity` should show the same account you're using in the console.

---

## Running the spikes

### S2 and S4: launch timing (`launch-and-measure.js`)

From `spikes/`:

```powershell
node aws/launch-and-measure.js --runs 5 --label alpine
```

For each run, the script:
1. Calls `RunTask`.
2. Polls until the task is RUNNING and its network interface has a **public DNS name**.
3. Writes that name to `mbg-spike-matches`.
4. Polls `https://<cloudfront>/m/<matchID>/healthz` until the container answers through CloudFront and the router (that is the `ready` time).
5. Stops the task.

It prints each step's time, a min/median/max summary, and saves every run to `aws/timings.jsonl`. Each run takes about a minute.

Record these in [RESULTS.md](RESULTS.md):
- **S2:** did every run get a `publicDnsKnown`? What does the name look like? How far was it from `running` ("public DNS vs RUNNING")?
- **S4:** the median and maximum `ready` times.

To see where the time goes, open **CloudWatch → Log groups → /ecs/mbg-spike-game-server** and look at a task's log. The `STARTING` and `LISTENING` lines show how long Node took to start inside the container.

**S4, trying a different base image.** Only do this if `ready` seems slow (say, over 30 seconds).
1. Build and push another variant from the repo root. If this is a new PowerShell window, set `$repo` and run `docker login` again as in Step 1 first.
   ```powershell
   docker buildx build --platform linux/arm64 --provenance=false --build-arg BASE=node:22-slim -f spikes/server/Dockerfile -t "${repo}:slim" --push .
   ```
2. Open **ECS → Task definitions → mbg-spike-game-server**, select the newest revision, and choose **Create new revision**. Change only the image tag to `:slim`, then choose **Create**. The script always uses the newest revision.
3. Run `node aws/launch-and-measure.js --runs 5 --label slim`. Compare the results, along with the image sizes in ECR.
4. Make another revision pointing back to `:alpine` when you're done.

### S1: WebSocket through CloudFront, and idle survival

1. Launch a task and leave it running:
   ```powershell
   node aws/launch-and-measure.js --keep
   ```
   At the end it prints the exact `ws-client.js` command to run next.
2. Run that command. It looks like this:
   ```powershell
   node client/ws-client.js --url https://dXXXX.cloudfront.net --match spike-xxxx --idle-minutes 20
   ```
   The client:
   - connects over WebSocket through CloudFront;
   - makes a real Ur move (a roll);
   - sends a chat message and waits for the echo;
   - stays idle for 20 minutes, logging Socket.IO pings each minute;
   - checks the connection with another chat round trip.

   It ends with **S1 RESULT: PASS** or **FAIL**. Any `DISCONNECTED` line during the idle period is a failure worth noting.
3. While it's idling, check that the task can't be reached directly. Use the `originHost` printed by the launch script:
   ```powershell
   curl.exe -m 10 http://ec2-x-x-x-x.compute-1.amazonaws.com:8000/m/spike-xxxx/healthz
   ```
   This should **time out**, because the security group only admits CloudFront.
4. Check the router's logs. Lambda@Edge writes its logs in the region of the edge location that served you, not necessarily us-east-1.
   1. Open **CloudWatch → Log groups** and search for `us-east-1.mbg-spike-router`. Try **us-east-1** first, then the region nearest you (for example us-east-2 or us-west-2).
   2. You should see one log line per WebSocket connection and per health-check request, not one per game message.
5. **Stop the task.** Open **ECS → Clusters → mbg-spike → Tasks**, tick the running task, and choose **Stop → Stop selected**.

### Optional: test from a real browser

The Node client uses the same Socket.IO client and options a browser would. If you also want to see it work in a browser:
1. While a `--keep` task is running, open any `https://` page (for example, the CloudFront URL itself) and open DevTools → Console.
2. Run:
   ```js
   new WebSocket("wss://dXXXX.cloudfront.net/m/spike-xxxx/socket.io/?EIO=4&transport=websocket").onmessage = e => console.log(e.data)
   ```
   You should see a `0{"sid":...}` message (the Engine.IO handshake) and then a `2` (a ping) after 10 seconds. The server closes this connection after about 30 seconds, because this bare WebSocket doesn't answer pings the way a real Socket.IO client does. That's expected.
