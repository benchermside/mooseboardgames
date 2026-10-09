# The siteAPI Lambda, in the same base image AWS runs it on. boto3 is already
# included in the image, just as it is in the real Lambda runtime.
FROM public.ecr.aws/lambda/python:3.12

COPY lambdas/siteAPI/src/ ${LAMBDA_TASK_ROOT}/

CMD ["lambda_function.lambda_handler"]
