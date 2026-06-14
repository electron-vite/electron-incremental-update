import { defaultDecompressFile } from '../utils/compress'
import { defaultVerifySignature } from '../utils/crypto'
import { defaultIsLowerVersion } from '../utils/version'

import type { DownloadingInfo, IProvider, UpdateInfoWithURL, VersionJSON } from './types'

export abstract class BaseProvider implements IProvider {
  public name = 'BaseProvider'
  /**
   * @inheritdoc
   */
  public isLowerVersion: IProvider['isLowerVersion'] = defaultIsLowerVersion
  /**
   * @inheritdoc
   */
  public verifySignature: IProvider['verifySignature'] = defaultVerifySignature
  /**
   * @inheritdoc
   */
  public decompressFile: IProvider['decompressFile'] = defaultDecompressFile

  /**
   * @inheritdoc
   */
  public abstract downloadJSON(
    name: string,
    versionPath: string,
    signal: AbortSignal,
  ): Promise<VersionJSON>

  /**
   * @inheritdoc
   */
  public abstract downloadAsar(
    info: UpdateInfoWithURL,
    signal: AbortSignal,
    onDownloading?: (info: DownloadingInfo) => void,
  ): Promise<Buffer>
}
