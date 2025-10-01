import supabase from "./supabase.js";

export async function createSignedUrls(paths: string[]) {
  const signedUrls: string[] = [];

  for (const path of paths) {
    const { data, error } = await supabase.storage
      .from("attachments")
      .createSignedUrl(path, 60 * 60);

    if (error) {
      console.error("Error creating signed URL:", error);
      continue;
    }

    signedUrls.push(data.signedUrl);
  }

  return signedUrls;
}
