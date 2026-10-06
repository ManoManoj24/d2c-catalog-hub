import path from "node:path";

process.env.DATABASE_URL = "postgres://pim:pim@127.0.0.1:5432/pim_test";
process.env.APP_DATABASE_URL = "postgres://pim_app:pim_app@127.0.0.1:5432/pim_test";
process.env.SESSION_SECRET = "test-session-secret-value";
process.env.ALLOW_LOCAL_MEDIA_URLS = "true";
process.env.OBJECT_STORE = "fs";
process.env.OBJECT_STORE_PATH = path.join(process.cwd(), "data/test-objects");
process.env.APP_ORIGIN = "http://127.0.0.1:3000";
process.env.JOB_MODE = "external";
process.env.JOB_BATCH_SIZE = "250";
