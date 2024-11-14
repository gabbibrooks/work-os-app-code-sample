import { Box, Button, Stack, Typography, useTheme } from "@mui/material";
import { LocalShipping } from "@mui/icons-material";
import { LoadingButton } from "@mui/lab";
import TextMessageInput from "@/components/TextMessageInput";
import FilePreview from "@/components/FilePreview";
import TemplateIcon from "@/components/Icons/TemplateIcon";
import PaperAirplane from "@/components/Icons/PaperAirplane";
import { Attachment } from "@mui/icons-material";
import cuid from "cuid";
import { useContext, useState, useRef } from "react";
import { ActionContext } from "@/models/ActionsProvider";
import { TrackingContext } from "@/models/TrackingStateProvider";
import { DataContext } from "@/models/DataProvider";
import { FeedContext } from "@/models/FeedContextProvider";
import { useParams } from "react-router-dom";
import UploadFileButton from "../UploadFiles/UploadFileButton";
import TemplatesModal from "../UploadFiles/TemplatesModal";
import FleetMessageModal from "../Scheduling/FleetMessageModal";
import { UxContext } from "@/models/UxStateProvider";
import { useDrop } from "react-aria";
import { UppyContext } from "@/models/UppyContextProvider";
import { AppContext } from "@/models/AppStateProvider";
import { fileUploadConfig } from "@/utils/config";
import Locator from "@/locator";
import { useHistoryState } from "@uidotdev/usehooks";
import useLocationChange from "@/hooks/useLocationChange";

type PastedFile = File & {
  url: string;
  name: string;
  data: File | Blob;
  fileId: string;
};

export default function TTSForm({
  disableControls,
}: { disableControls?: boolean }) {
  const theme = useTheme();
  const params = useParams();
  const { client } = useContext(AppContext);
  const { publishToWorkspaceFeed } = useContext(ActionContext);
  const {
    myAccountId,
    isWorkspaceLimitedMember,
    preferredLanguage,
    currentFeed,
  } = useContext(DataContext);
  let {
    setTemplatesModal,
    setStatus: setFeedStatus,
    scrollToBottomOfFeed,
  } = useContext(FeedContext);
  const { ampli } = useContext(TrackingContext);
  const { uppyClient } = useContext(UppyContext);
  const { isSmUp, setFleetMessageModalOpen } = useContext(UxContext);
  const {
    state: textState,
    set: setText,
    undo: undoText,
    redo: redoText,
    clear: clearText,
    canUndo: canUndoText,
    canRedo: canRedoText,
  } = useHistoryState({ textInputValue: "" });
  const [loading, setLoading] = useState<boolean>(false);
  const [files, setFiles] = useState<PastedFile[]>([]);
  const [groupId, setGroupId] = useState<string>(cuid());
  const textInputRef = useRef(null);
  const workspaceId = params?.workspaceId as string;
  const feedId = params?.feedId as string;
  const limitedMember = isWorkspaceLimitedMember(workspaceId, myAccountId);

  const maxChars = 5000;

  const exceededCharLimit = textState.textInputValue.length > maxChars;
  const canSendMessage =
    (textState.textInputValue?.length > 0 || files.length > 0) &&
    !exceededCharLimit;

  const disabled = loading || disableControls;
  const fileTypes =
    fileUploadConfig.allowedMimeTypes.length > 0
      ? fileUploadConfig.allowedMimeTypes?.filter(
          (at) =>
            at.startsWith("image") ||
            at.startsWith("application") ||
            at.startsWith("text"),
        )
      : ["image/jpeg", "image/png", "image/svg+xml", "application/pdf"];

  useLocationChange(() => {
    clearText();
  });

  const removeFile = (index) => {
    if (files.length > 0) {
      const newFiles = files.filter((file, i) => i !== index);
      if (uppyClient) {
        const file = files[index];
        uppyClient.removeFile(file?.fileId);
      }
      setFiles(newFiles);
    }
  };

  const reset = () => {
    setLoading(false);
    clearText();
    setFiles([]);
    uppyClient?.setOptions({ restrictions: { maxNumberOfFiles: 1 } });
    setGroupId(cuid());
    setTimeout(() => textInputRef.current?.focus(), 50);
  };

  const sendTextMessage = async () => {
    if (canSendMessage) {
      const contentId = cuid();
      try {
        setLoading(true);
        setFeedStatus({ message: "Sending message...", severity: "info" });
        if (textState.textInputValue.length > 0) {
          ampli.textToSpeechMessageSend();

          client.createContentEvent({
            workspaceId,
            contentId,
            step: "client_uploading",
            status: "started",
            feedId,
            context: `tts_message, characterLength: ${textState.textInputValue?.length}`,
          });

          await publishToWorkspaceFeed({
            workspaceId,
            feedId,
            contentId,
            groupId,
            text: textState?.textInputValue,
            preferredLanguage,
            isSilent: currentFeed?.isSilent === 1 ? true : false,
          });

          client.createContentEvent({
            workspaceId,
            contentId,
            step: "client_uploading",
            status: "finished",
            feedId,
            context: `tts_message, characterLength: ${textState.textInputValue?.length}`,
          });
        }

        if (files.length > 0) {
          // Start the upload
          await uppyClient?.upload();
        }
        setFeedStatus(null);
        // after sending message, scroll to bottom of the feed if present
        scrollToBottomOfFeed();
      } catch (error) {
        setFeedStatus({ message: "Failed to send message", severity: "error" });
        client.createContentEvent({
          workspaceId,
          contentId,
          step: "client_uploading",
          status: "failed",
          feedId,
          context: `tts_message, characterLength:${textState.textInputValue?.length}`,
          error,
        });
        return Promise.reject(error);
      } finally {
        reset();
      }
    }
  };

  const handleNewFileAdded = (file: File) => {
    if (file) {
      const url = URL.createObjectURL(file);
      const newFile = {
        url,
        name: file.name,
        type: file.type,
        data: file,
      } as PastedFile;
      const addedId = uppyClient.addFile({
        source: "TTSForm",
        meta: { groupId: groupId },
        ...newFile,
      });
      newFile.fileId = addedId || "";
      setFiles((prev) => [...prev, newFile]);
    }
  };

  const handlePaste = (event) => {
    event.preventDefault();
    const items = Array.from(
      (event.clipboardData || event.originalEvent.clipboardData).items,
    ) as DataTransferItem[];

    if (items) {
      uppyClient?.setOptions({ restrictions: { maxNumberOfFiles: null } });
      items.map(async (item) => {
        if (
          (item.kind === "file" || item.kind === "image") &&
          fileTypes.includes(item.type)
        ) {
          const file = item.getAsFile();
          handleNewFileAdded(file);
        }

        // Only accept plain text values for this input type
        if (item.kind === "string" && item.type === "text/plain") {
          const cursorStartPosition = event.target.selectionStart || 0;
          const cursorEndPosition =
            event.target.selectionEnd || textState?.textInputValue?.length;
          item.getAsString((text) => {
            handleTextInput(
              textState?.textInputValue.slice(0, cursorStartPosition) +
                text +
                textState?.textInputValue.slice(cursorEndPosition),
            );
            // "setTimeout" to update caret after setting the text
            window.requestAnimationFrame(() => {
              textInputRef.current?.setSelectionRange(
                cursorStartPosition + text.length,
                cursorStartPosition + text.length,
              );
            });
          });
        }
      });
    }
  };

  const handleFleetMessageOpen = () => {
    ampli.openFleetMessage({ workspaceId });
    setFleetMessageModalOpen(true);
  };

  let { dropProps } = useDrop({
    ref: textInputRef,
    async onDrop(e) {
      console.log("onDrop", e);
      if (e.items) {
        uppyClient?.setOptions({ restrictions: { maxNumberOfFiles: null } });
        e.items.map(async (item) => {
          if (item.kind === "file" && fileTypes.includes(item.type)) {
            const file = await item.getFile();
            handleNewFileAdded(file);
          }

          if (item.kind === "text") {
            const textType = Array.from(item.types.values())?.[0];
            const text = await item.getText(textType || "text/plain");
            handleTextInput(textState?.textInputValue + text);
          }
        });
      }
    },
  });

  const handleKeyDown = async (
    event: React.KeyboardEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLDivElement
    >,
  ) => {
    switch (event.code) {
      case "Enter":
      case "NumpadEnter":
        // if (event.shiftKey) break;
        event.preventDefault();
        await sendTextMessage();
        break;
      case "KeyZ":
        if (event.ctrlKey || event.metaKey) {
          if (event.shiftKey) {
            if (canRedoText) {
              redoText();
            }
          } else {
            if (canUndoText) {
              undoText();
            }
          }
        }
        break;
    }
  };

  const handleTextInput = (text: string) => {
    setText({ textInputValue: text });
  };

  const handleTemplateSelection = (template: string) => {
    handleTextInput(template);
    setTimeout(() => textInputRef.current?.focus(), 50);
  };

  return (
    <Stack
      {...dropProps}
      sx={{
        width: "100%",
        height: "100%",
        gap: 1,
        position: "relative",
      }}
    >
      <Box
        sx={{
          px: 2.25,
          py: 2.5,
          height: "auto",
          background: theme.palette.secondary.dark,
          borderRadius: "24px",
          boxShadow: "0px 2px 8px 0px #04070540",
          border: `1px solid transparent`,
          borderColor: exceededCharLimit
            ? theme.palette.error.main
            : "transparent",
          "&:focus-within": {
            borderColor: theme.palette.primary.main,
          },
        }}
      >
        <TextMessageInput
          inputId="tts-form-text-input"
          inputRef={textInputRef}
          inputProps={{
            autoFocus: true,
            onKeyDown: (e) => handleKeyDown(e),
            onPaste: (e) => handlePaste(e),
          }}
          className="text-input-v2"
          rows={0}
          minRows={1}
          placeholder="Start typing your message"
          aria-label={Locator.feed.input.tts}
          disabled={disabled}
          textInputValue={textState?.textInputValue}
          textInputHandler={handleTextInput}
          sx={{
            ".MuiInputBase-input": {
              width: "100%",
              borderRadius: 0,
              height: "100%",
              ":focus-visible": {
                boxShadow: "none",
              },
            },
            "&.text-input-v2 textarea": {
              minHeight: 44,
              maxHeight: 200,
              overflowY: "auto !important",
              padding: 0,
            },
          }}
          showHelperText={false}
        />
        <Stack
          sx={{
            borderTop: `1px solid ${theme.palette.neutral.main}`,
            pt: 2,
            gap: 2,
          }}
        >
          {files?.length > 0 ? (
            <Stack
              sx={{
                width: "100%",
                flexDirection: "row",
                alignItems: "center",
                gap: 2,
                overflowX: "auto",
                paddingTop: "10px",
              }}
            >
              {files.map((file, index) => {
                return (
                  <FilePreview
                    key={`file-preview-${file.name}`}
                    index={index}
                    url={file.url}
                    type={file.type}
                    name={file.name}
                    disabledRemove={disabled}
                    removeFileCallback={(i) => removeFile(i)}
                  />
                );
              })}
            </Stack>
          ) : null}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              flexDirection: { xs: "column", sm: "row" },
              width: "100%",
              gap: 2,
            }}
          >
            <Box
              sx={{
                flexGrow: 1,
                display: "flex",
                gap: 2,
                alignSelf: "flex-start",
              }}
            >
              {!limitedMember ? (
                <Button
                  type="button"
                  onClick={() => setTemplatesModal(true)}
                  sx={{
                    display: "flex",
                    background: theme.palette.secondary.main,
                    alignItems: "center",
                    justifyItems: "center",
                    borderRadius: isSmUp ? 6 : "100%",
                    width: isSmUp ? "auto" : 44,
                    height: isSmUp ? "auto" : 44,
                    minWidth: 0,
                    px: isSmUp ? 2 : 1,
                    gap: 1,
                  }}
                  disabled={disabled}
                  aria-label={Locator.feed.input.templates.main}
                >
                  <TemplateIcon />{" "}
                  {isSmUp ? (
                    <Box sx={{ textTransform: "none" }}>Templates</Box>
                  ) : null}
                </Button>
              ) : null}
              <UploadFileButton
                sx={{
                  display: "flex",
                  background: theme.palette.secondary.main,
                  alignItems: "center",
                  justifyItems: "center",
                  borderRadius: isSmUp ? 6 : "100%",
                  width: isSmUp ? "auto" : 44,
                  height: isSmUp ? "auto" : 44,
                  minWidth: 0,
                  px: isSmUp ? 2 : 1,
                  gap: 1,
                }}
                disabled={disabled}
              >
                <Attachment role="presentation" />
                {isSmUp ? (
                  <Box sx={{ textTransform: "none" }}>Files</Box>
                ) : null}
              </UploadFileButton>
              {!limitedMember ? (
                <Button
                  type="button"
                  onClick={handleFleetMessageOpen}
                  sx={{
                    display: "flex",
                    background: theme.palette.secondary.main,
                    alignItems: "center",
                    justifyItems: "center",
                    borderRadius: isSmUp ? 6 : "100%",
                    width: isSmUp ? "auto" : 44,
                    height: isSmUp ? "auto" : 44,
                    minWidth: 0,
                    px: isSmUp ? 2 : 1,
                    gap: 1,
                  }}
                  disabled={disabled}
                  aria-label={Locator.feed.input.fleetMessage.main}
                >
                  <LocalShipping />{" "}
                  {isSmUp ? (
                    <Box sx={{ textTransform: "none" }}>Fleet message</Box>
                  ) : null}
                </Button>
              ) : null}
            </Box>
            <Stack
              sx={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 2,
              }}
            >
              {exceededCharLimit ? (
                <Typography sx={{ color: theme.palette.error.main }}>
                  Exceeding character limit
                </Typography>
              ) : null}
              <Typography
                sx={{
                  color: exceededCharLimit
                    ? theme.palette.error.main
                    : theme.palette.neutral.main,
                }}
              >
                {textState?.textInputValue?.length} / {maxChars}
              </Typography>
              <LoadingButton
                type="submit"
                loading={loading}
                variant="contained"
                disabled={!canSendMessage}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyItems: "center",
                  borderRadius: "100%",
                  minWidth: 0,
                  width: "44px",
                  height: "44px",
                  padding: 1,
                }}
                aria-label={Locator.feed.input.send}
                onClick={sendTextMessage}
              >
                {!loading ? (
                  <PaperAirplane
                    style={{
                      fill: !canSendMessage
                        ? theme.palette.neutral.main
                        : theme.palette.primary.main,
                      height: "20px",
                      width: "20px",
                    }}
                  />
                ) : null}
              </LoadingButton>
            </Stack>
          </Box>
        </Stack>
      </Box>
      <TemplatesModal templateSelectionCallback={handleTemplateSelection} />
      <FleetMessageModal />
    </Stack>
  );
}
