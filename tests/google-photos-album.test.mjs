import assert from "node:assert/strict";
import test from "node:test";

import {
  extractGooglePhotosAlbumPhotos,
  googlePhotosDownloadUrl,
  isGooglePhotosAlbumUrl,
} from "../src/lib/google-photos-album.ts";

// Note triage, lectures beefbfba, 31cf1f1c and 58680a49: shared albums of photographed notebook
// pages, read as an app shell with no text. The shape below is the album page's loader data.
const entry = (id, key) =>
  `["${id}",["https://lh3.googleusercontent.com/pw/${key}",3060,4080,null,null,null,null,null,null,[1]],1729000000000,"x",0]`;
const albumHtml = [
  '<html><head><title>Zvezek - Google Photos</title></head><body>',
  '<img src="https://lh3.googleusercontent.com/a/ACg8ocAvatar=s32-c">',
  "<script>AF_initDataCallback({key: 'ds:0', data:[[",
  entry("AF1QipFirstPage", "AP1GczFirst"),
  ",",
  entry("AF1QipSecondPage", "AP1GczSecond"),
  ",",
  entry("AF1QipFirstPage", "AP1GczFirst"),
  ']]});</script><script>["AF1QipElsewhere",["https://evil.example/pw/AP1Gcz",1,1]]</script>',
  "</body></html>",
].join("");

test("a shared album's photos are its entries, in order, once each", () => {
  assert.deepEqual(extractGooglePhotosAlbumPhotos(albumHtml), [
    { id: "AF1QipFirstPage", url: "https://lh3.googleusercontent.com/pw/AP1GczFirst" },
    { id: "AF1QipSecondPage", url: "https://lh3.googleusercontent.com/pw/AP1GczSecond" },
  ]);
});

test("a page with no album entries has no photos", () => {
  assert.deepEqual(extractGooglePhotosAlbumPhotos("<html><body>Google Photos</body></html>"), []);
});

test("a photo is fetched at the size the reader keeps", () => {
  assert.equal(
    googlePhotosDownloadUrl({ id: "AF1Qip", url: "https://lh3.googleusercontent.com/pw/AP1Gcz" }).toString(),
    "https://lh3.googleusercontent.com/pw/AP1Gcz=w3072-h3072",
  );
});

test("only a shared album's page is an album", () => {
  assert.equal(isGooglePhotosAlbumUrl(new URL("https://photos.google.com/share/AF1QipAlbum?key=abc")), true);
  assert.equal(isGooglePhotosAlbumUrl(new URL("https://photos.google.com/u/0/share/AF1QipAlbum")), true);
  assert.equal(isGooglePhotosAlbumUrl(new URL("https://photos.google.com/")), false);
  assert.equal(isGooglePhotosAlbumUrl(new URL("https://photos.google.com/share/AF1QipAlbum/photo/AF1QipOne")), false);
  assert.equal(isGooglePhotosAlbumUrl(new URL("https://photos.app.goo.gl/abc")), false);
  assert.equal(isGooglePhotosAlbumUrl(new URL("https://example.com/share/AF1QipAlbum")), false);
});
