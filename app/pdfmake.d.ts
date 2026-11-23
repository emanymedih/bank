declare module "pdfmake/build/pdfmake.js" {
  const pdfMake: {
    addVirtualFileSystem(files: Record<string, string>): void;
    createPdf(definition: object): { download(filename: string, callback: () => void): void; print(options: object, target: Window): void };
  };
  export default pdfMake;
}

declare module "pdfmake/build/vfs_fonts.js" {
  const files: Record<string, string>;
  export default files;
}
