const fs = require("fs");
const { google } = require("googleapis");
const ROOT_FOLDER_ID = "1JOjWuwkKZGO3vEU1H6AoXHulnpMouc_x";

const auth = new google.auth.GoogleAuth({
  credentials: {
    type: "service_account",
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
  },
  scopes: ["https://www.googleapis.com/auth/drive"],
});

const drive = google.drive({
  version: "v3",
  auth,
});

async function findFolderByName(folderName) {
  const response = await drive.files.list({
    q: `name='${folderName}' and '${ROOT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id,name)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return response.data.files[0] || null;
}

async function createFolder(folderName) {
  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [ROOT_FOLDER_ID],
    },
    supportsAllDrives: true,
  });

  return folder.data.id;
}

async function getOrCreateSubFolder(parentId, folderName) {
  const response = await drive.files.list({
    q: `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id,name)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (response.data.files.length) {
    return response.data.files[0].id;
  }

  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    supportsAllDrives: true,
  });

  return folder.data.id;
}

async function uploadFile(filePath, fileName, jobNumber) {
  let folder = await findFolderByName(jobNumber);

  let folderId;

  if (folder) {
    folderId = folder.id;
  } else {
    folderId = await createFolder(jobNumber);
  }

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      body: fs.createReadStream(filePath),
    },
    supportsAllDrives: true,
  });

  return response.data.id;
}

const path = require("path");

async function uploadJobImagesToDrive(jobNumber, images) {
  let folder = await findFolderByName(jobNumber);

  let jobFolderId;

  if (folder) {
    jobFolderId = folder.id;
  } else {
    jobFolderId = await createFolder(jobNumber);
  }

  const beforeFolderId = await getOrCreateSubFolder(jobFolderId, "Before");

  const afterFolderId = await getOrCreateSubFolder(jobFolderId, "After");

  const issueFolderId = await getOrCreateSubFolder(jobFolderId, "Issue");

  await uploadCategory(images.beforeImages || [], beforeFolderId);

  await uploadCategory(images.afterImages || [], afterFolderId);

  await uploadCategory(images.issueImages || [], issueFolderId);
  const chatFolderId = await getOrCreateSubFolder(jobFolderId, "Chat Images");

  await uploadCategory(images.chatImages || [], chatFolderId);

  return true;
}

async function uploadCategory(imageArray, folderId) {
  for (const imageUrl of imageArray) {
    const relativePath = imageUrl.replace(/^\/+/, "");

    const fullPath = path.join(process.cwd(), relativePath);

    if (!fs.existsSync(fullPath)) {
      console.log("File not found:", fullPath);
      continue;
    }

    await drive.files.create({
      requestBody: {
        name: path.basename(fullPath),
        parents: [folderId],
      },
      media: {
        body: fs.createReadStream(fullPath),
      },
      supportsAllDrives: true,
    });
  }
}

module.exports = {
  uploadFile,
  uploadJobImagesToDrive,
  uploadCategory,
  getOrCreateSubFolder,
  findFolderByName,
  createFolder,
};
