/**
 * 会员购买说明页（v9.20）——爱发电自动发货卡密闭环的「购买入口」。
 *
 * 从账号页会员卡「获取兑换码 · 前往购买」进入。三块能力：
 *  1. 定价卡：月卡 ¥4.9 / 30 天 + 四项权益 + 「前往爱发电购买」外链（付款后码在爱发电订单页查看）
 *  2. 三步开通 + FAQ（折叠）：讲清「站外购买、站内激活」的边界，减少流失
 *  3. 兑换回填：与账号页同一套兑换逻辑（组件内自持状态），买完直接回来粘贴激活
 *
 * 兑换成功后关闭本页回到账号页，账号页监听到 purchaseOpen 关闭会自动刷新会员卡。
 */
import { useState } from 'react'
import type { JSX } from 'react'
import { useApp } from '@/app/context'
import { fetchMember, getAccessToken, redeemCode } from './cloudbase'
import settingsStyles from './SettingsView.module.css'
import styles from './PurchaseView.module.css'

/** 爱发电店铺链接：商品上架后替换为真实链接（当前为占位） */
const AFDIAN_SHOP_URL = 'https://afdian.net/a/daycell'

/** v9.20 会员皇冠（金色），复用账号页视觉 */
function Crown({ size = 26 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.2l2 4.1 4.6.7-3.3 3.2.8 4.6L12 13.7l-4.1 2.1.8-4.6-3.3-3.2 4.6-.7z"
        fill="#B08A3E"
      />
      <rect x="7.5" y="20.5" width="9" height="1.6" rx="0.8" fill="#B08A3E" opacity=".55" />
    </svg>
  )
}

/** v9.20 权益行：绿勾（已解锁） */
function PerkOn({ txt, tag }: { txt: string; tag: string }): JSX.Element {
  return (
    <div className={styles.perkRow}>
      <svg className={styles.perkIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="#34c759" opacity=".15" />
        <path d="M7.5 12.3l3 3 6-6.5" stroke="#2d9d50" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={styles.perkTxt}>{txt}</span>
      <span className={styles.perkTag}>{tag}</span>
    </div>
  )
}

interface FaqItem {
  q: string
  a: string
}

const FAQS: FaqItem[] = [
  {
    q: '付款后兑换码在哪里看？',
    a: '支付在爱发电完成，兑换码由爱发电自动发货：下单成功后，码会出现在爱发电订单页（卡密区），同时私信自动推送一条带码消息。复制后回到 DayCell 粘贴激活即可。',
  },
  {
    q: '没收到码 / 码无效怎么办？',
    a: '确认是否在爱发电订单页查看（不是邮件）。仍找不到或激活提示码无效，请通过爱发电私信或页面底部的联系邮箱反馈订单号，我会补发一枚新码。',
  },
  {
    q: '兑换后有效期怎么算？',
    a: '自激活当日起生效 30 天；会员到期后自动恢复免费版。一个兑换码只能激活一次，再次购买新码后从到期时刻顺延叠加。',
  },
]

export function PurchaseView(): JSX.Element {
  const closePurchase = useApp((s) => s.closePurchase)
  const [redeemCodeVal, setRedeemCodeVal] = useState('')
  const [redeemState, setRedeemState] = useState<{ phase: 'idle' | 'busy' | 'ok' | 'fail'; msg?: string }>({
    phase: 'idle',
  })

  // v9.20 兑换核销：与账号页同逻辑（成功 → 提示并关闭本页，账号页自动刷新会员卡）
  const onRedeem = async (): Promise<void> => {
    const code = redeemCodeVal.trim()
    if (!code || redeemState.phase === 'busy') return
    setRedeemState({ phase: 'busy' })
    const token = await getAccessToken()
    if (!token) {
      setRedeemState({ phase: 'fail', msg: '登录状态失效，请重新登录' })
      return
    }
    const r = await redeemCode(token, code)
    if (!r.ok) {
      setRedeemState({
        phase: 'fail',
        msg:
          r.error === 'invalid_code'
            ? '兑换码不存在，请检查后重试'
            : r.error === 'code_used'
              ? '该兑换码已被使用'
              : (r.error ?? '兑换失败，请稍后重试'),
      })
      return
    }
    setRedeemState({ phase: 'ok', msg: `会员已开通 ${r.days ?? 30} 天` })
    setRedeemCodeVal('')
    // 拉取最新会员状态验证生效，随后关页回账号页（账号页会自行刷新展示）
    const m = await fetchMember(token)
    if (!m.ok) return
    closePurchase()
  }

  return (
    <div className={settingsStyles.overlay}>
      <div className={settingsStyles.page}>
        <div className={settingsStyles.head}>
          <button className={settingsStyles.back} onClick={closePurchase}>
            ← 返回
          </button>
          <h1 className={settingsStyles.h1}>购买会员</h1>
          <span className={settingsStyles.headSpacer} />
        </div>

        <div className={settingsStyles.body}>
          {/* 定价卡 */}
          <div className={`${styles.mcard} ${styles.mcardGold}`} data-testid="purchase-card">
            <div className={styles.mcardHead}>
              <Crown />
              <div>
                <div className={styles.mcardTitle}>DayCell 会员 · 月卡</div>
                <div className={styles.mcardPrice}>
                  <span className={styles.priceNum}>¥4.9</span>
                  <span className={styles.priceUnit}>/ 30 天</span>
                </div>
              </div>
            </div>
            <div className={styles.perkList}>
              <PerkOn txt="AI 智能整理（语音 / 文本导入）" tag="每日可用" />
              <PerkOn txt="AI 周 / 月深度复盘" tag="已解锁" />
              <PerkOn txt="周日周报推送" tag="已开启" />
              <PerkOn txt="云同步设备数" tag="最多 5 台" />
            </div>
            <a
              className={styles.ctaBtn}
              href={AFDIAN_SHOP_URL}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="purchase-cta"
            >
              前往爱发电购买
            </a>
            <div className={styles.ctaHint}>付款后兑换码在爱发电订单页查看，复制后回来粘贴激活</div>
          </div>

          {/* 三步开通 */}
          <div className={styles.sectionTitle}>三步开通</div>
          <div className={styles.steps}>
            <div className={styles.step}>
              <div className={styles.stepNum}>1</div>
              <div className={styles.stepTxt}>
                <div className={styles.stepTitle}>爱发电下单</div>
                <div className={styles.stepDesc}>支付宝 / 微信支付 ¥4.9</div>
              </div>
            </div>
            <div className={styles.step}>
              <div className={styles.stepNum}>2</div>
              <div className={styles.stepTxt}>
                <div className={styles.stepTitle}>自动发货收码</div>
                <div className={styles.stepDesc}>订单页 / 私信即时收到兑换码</div>
              </div>
            </div>
            <div className={styles.step}>
              <div className={styles.stepNum}>3</div>
              <div className={styles.stepTxt}>
                <div className={styles.stepTitle}>回 DayCell 激活</div>
                <div className={styles.stepDesc}>粘贴兑换码，会员立即生效 30 天</div>
              </div>
            </div>
          </div>

          {/* FAQ */}
          <div className={styles.sectionTitle}>常见问题</div>
          <div className={styles.faqList}>
            {FAQS.map((f) => (
              <details key={f.q} className={styles.faqItem}>
                <summary className={styles.faqQ}>{f.q}</summary>
                <div className={styles.faqA}>{f.a}</div>
              </details>
            ))}
          </div>

          {/* 兑换回填（与账号页同组件逻辑） */}
          <div className={styles.sectionTitle}>我已购买 · 激活兑换码</div>
          <div className={styles.redeemBox}>
            <div className={styles.redeemRow}>
              <input
                className={settingsStyles.redeemInput}
                value={redeemCodeVal}
                onChange={(e) => setRedeemCodeVal(e.target.value.toUpperCase())}
                placeholder="粘贴爱发电收到的兑换码"
                data-testid="purchase-redeem-input"
              />
              <button
                className={settingsStyles.redeemBtn}
                disabled={redeemState.phase === 'busy' || !redeemCodeVal.trim()}
                onClick={() => void onRedeem()}
                data-testid="purchase-redeem-btn"
              >
                {redeemState.phase === 'busy' ? '激活中…' : '激活会员'}
              </button>
            </div>
            {redeemState.phase === 'ok' && <div className={settingsStyles.okLine}>✓ {redeemState.msg}</div>}
            {redeemState.phase === 'fail' && <div className={settingsStyles.errLine}>✗ {redeemState.msg}</div>}
            <div className={styles.redeemHint}>激活后回到账号页，会员卡变为金色并展示有效期</div>
          </div>

          <div className={styles.foot}>
            购买即代表同意：兑换码一码一次激活 · 虚拟商品售出后不支持退款
            <br />
            遇到问题可发邮件至{' '}
            <a href="mailto:daycell.support@example.com" className={styles.mailLink}>
              daycell.support@example.com
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
