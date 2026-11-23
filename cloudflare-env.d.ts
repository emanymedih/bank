declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    AVTO_VIN_COD_TOKEN?: string;
  }
}
