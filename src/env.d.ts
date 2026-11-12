interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly BASE_URL: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
declare module "*.css" {}
