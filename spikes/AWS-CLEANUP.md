# AWS cleanup after the Phase 0 spikes

Do these steps in order. Later steps fail if earlier resources still use them. Everything is in **us-east-1**, except a few Lambda@Edge log groups (step 9).

Lambda@Edge can't be deleted until a few hours after the distribution is gone. So expect to do steps 1–2 now and finish the rest later the same day. Nothing left over after step 2 costs anything noticeable while you wait.

## 1. Stop any running tasks

1. Open **ECS → Clusters → mbg-spike → Tasks**.
2. If any tasks are listed as running, tick them and choose **Stop → Stop selected**.
3. Set the filter to show **Stopped** tasks, and wait until they all show STOPPED.

Running tasks are the only thing in this spike that costs money by the hour.

## 2. Disable and delete the CloudFront distribution

1. Open **CloudFront → Distributions**, select the spike distribution (the one with origin `example.com`), and choose **Disable**. Confirm.
2. Wait until its **Last modified** column shows a date instead of **Deploying**. This takes 3 to 10 minutes.
3. Select it again and choose **Delete**. Confirm.
4. Open **CloudFront → Policies → Origin request**, select **mbg-spike-ws**, and choose **Delete**.

## 3. Delete the Lambda@Edge function (a few hours later)

CloudFront has to remove the copies of the function it placed at its edge locations, and this usually takes a few hours after the distribution is deleted.

1. Open **Lambda → Functions** (in us-east-1), select **mbg-spike-router**, and choose **Actions → Delete**.
2. If it says the function is a replicated function and can't be deleted yet, try again later.

## 4. Delete the ECS task definitions and cluster

1. Deregister the task definitions:
   1. Open **ECS → Task definitions → mbg-spike-game-server**.
   2. Tick **every** revision, then choose **Actions → Deregister** and confirm.
2. Delete them:
   1. Change the status filter to **Inactive**.
   2. Tick every revision, choose **Actions → Delete**, and confirm.
   3. Deletion finishes in the background after a short while.
3. Delete the cluster:
   1. Open **ECS → Clusters → mbg-spike → Delete cluster**.
   2. Type the confirmation text and choose **Delete**.
   3. This also removes the CloudFormation stack the console created for the cluster.
4. Check the stack is gone: open **CloudFormation → Stacks**. There should be no stack whose name starts with `Infra-ECS-Cluster-mbg-spike`. If there is one, select it and choose **Delete**.

## 5. Delete the ECR repository

1. Open **ECR → Private registry → Repositories**.
2. Select **mbg-spike-game-server** and choose **Delete**.
3. Type `delete` and confirm. This deletes all of its images too.

## 6. Delete the DynamoDB table

1. Open **DynamoDB → Tables**.
2. Select **mbg-spike-matches** and choose **Delete**.
3. Untick **Create an on-demand backup**, type `confirm`, and choose **Delete table**.

## 7. Delete the security group

1. Open **VPC → Security groups**.
2. Select **mbg-spike-task-sg** and choose **Actions → Delete security groups**.

If AWS says the group is still in use by a network interface, the stopped tasks' interfaces haven't been released yet. Wait 10 minutes and try again.

**Don't** delete the default VPC or its subnets. They existed before the spike, and they're free.

## 8. Delete the IAM role

1. Open **IAM → Roles**.
2. Select **mbg-spike-router-role** and choose **Delete**. Type the role name to confirm.
3. **Keep `ecsTaskExecutionRole`.** It's free, and Phase 1 will use it. If you do want it gone, delete it the same way, but only if nothing else in your account uses ECS.

## 9. Delete the log groups

1. Open **CloudWatch → Logs → Log groups** in **us-east-1**.
2. Delete **/ecs/mbg-spike-game-server**: select it, then choose **Actions → Delete log group(s)**.
3. In the search box, type `mbg-spike-router` and delete anything that matches.
4. Lambda@Edge also creates a log group named **/aws/lambda/us-east-1.mbg-spike-router** in each region whose edge locations served you. These log groups never expire on their own. Switch the region menu to each region near you and delete it there if it exists. Check at least:
   - us-east-2 (Ohio)
   - us-west-1 (N. California)
   - us-west-2 (Oregon)
   - ca-central-1 (Canada)

## 10. Clean up locally

From the repo root in PowerShell:
```powershell
docker image ls "*mbg-spike-game-server*"
docker image rm <each IMAGE ID listed>
docker logout ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com
```

Keep `spikes/aws/timings.jsonl` until you've filled in RESULTS.md. Both `timings.jsonl` and `config.json` are gitignored.

## 11. Final check

- **ECS:** no clusters named `mbg-spike`, and no running tasks.
- **CloudFront:** no spike distribution.
- **Lambda:** no `mbg-spike-router`.
- **ECR:** no `mbg-spike-game-server`.
- **DynamoDB:** no `mbg-spike-matches`.
- **EC2 → Network interfaces:** filter by the security group name `mbg-spike-task-sg`. You should see nothing (or the group itself is already gone).
- **Billing and Cost Management → Bills:** after a day or two, this month's charges for ECS, CloudFront, Lambda, DynamoDB, and EC2 (public IPv4) should be pennies and should stop growing.
- If you made the `mbg-spike-budget` budget, delete it under **Budgets**, or keep it as a general alert.
