import { motion, useReducedMotion } from 'framer-motion'
import { formatHHMM } from '../../utils/antGenerator'
import { clockMinuteParts } from '../../utils/cbat/antVisualBreakdown'

const ease = [0.22, 1, 0.36, 1]

function Step({ number, eyebrow, title, children, delay = 0, reduceMotion }) {
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease }}
      className="ant-logic-step"
    >
      <div className="ant-logic-step-number">{number}</div>
      <div className="min-w-0 flex-1">
        <p className="ant-logic-eyebrow">{eyebrow}</p>
        <p className="text-sm sm:text-base font-bold text-white leading-snug">{title}</p>
        {children}
      </div>
    </motion.div>
  )
}

function Equation({ children, answer }) {
  return (
    <div className="ant-logic-equation">
      <span>{children}</span>
      <span className="text-slate-500">=</span>
      <strong>{answer}</strong>
    </div>
  )
}

function ClockChips({ round, hideAnswer = false, reduceMotion }) {
  const parts = clockMinuteParts(round.timeNowMin, round.arrivalMin)
  return (
    <div className="ant-clock-work" aria-label="Clock time split at each hour">
      {parts.map((part, i) => {
        const concealed = hideAnswer && i === parts.length - 1
        return (
          <motion.div
            key={`${part.from}-${part.to}`}
            className="ant-clock-hop"
            initial={reduceMotion ? false : { opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.38, delay: i * 0.16, ease }}
          >
            <div className="ant-clock-face" aria-hidden="true"><i /><b>{formatHHMM(part.from)}</b></div>
            <div className="ant-clock-arrow"><span>+{part.minutes} min</span><i /></div>
            <div className={`ant-clock-face ${concealed ? 'is-question' : ''}`} aria-hidden="true"><i /><b>{concealed ? '????' : formatHHMM(part.to)}</b></div>
          </motion.div>
        )
      })}
      {parts.length > 1 && (
        <p className="ant-clock-total">
          {parts.map(p => p.minutes).join(' + ')} = <strong>{parts.reduce((sum, p) => sum + p.minutes, 0)} minutes</strong>
        </p>
      )}
    </div>
  )
}

function Journey({ round, label, reduceMotion, hideArrival = false }) {
  const minutes = round.arrivalMin - round.timeNowMin
  return (
    <div className="ant-journey" aria-label={`${minutes} minute journey leaving at ${formatHHMM(round.timeNowMin)}`}>
      <div className="ant-journey-place">
        <div className="ant-place-icon" aria-hidden="true">🛫</div>
        <strong>{formatHHMM(round.timeNowMin)}</strong>
        <span>leave</span>
      </div>
      <div className="ant-road-wrap">
        <div className="ant-road">
          <div className="ant-road-centre" />
          <motion.div
            className="ant-plane"
            initial={reduceMotion ? { left: '50%' } : { left: '4%' }}
            animate={{ left: '88%' }}
            transition={{ duration: 1.8, delay: 0.25, ease }}
            aria-hidden="true"
          >✈</motion.div>
        </div>
        <div className="ant-road-label"><strong>{minutes}</strong> one-minute parts</div>
      </div>
      <div className="ant-journey-place">
        <div className="ant-place-icon" aria-hidden="true">🏠</div>
        <strong>{hideArrival ? '????' : formatHHMM(round.arrivalMin)}</strong>
        <span>{label}</span>
      </div>
    </div>
  )
}

function MinuteStrip({ minutes, perMinute, unit = 'miles', reduceMotion }) {
  const groups = Array.from({ length: Math.ceil(minutes / 60) }, (_, group) => Math.min(60, minutes - group * 60))
  return (
    <div className="mt-4">
      <div className="space-y-1">
        {groups.map((count, group) => (
          <div key={group} className="ant-minute-strip" style={{ '--minute-count': count }}>
            {Array.from({ length: count }, (_, i) => (
              <motion.div
                key={i}
                className="ant-minute-tick"
                initial={reduceMotion ? false : { opacity: 0, scaleY: 0.25 }}
                animate={{ opacity: 1, scaleY: 1 }}
                transition={{ duration: 0.2, delay: Math.min((group * 60 + i) * 0.012, 0.7) }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 mt-2 text-[11px] text-slate-400">
        <span>1 minute = <b className="text-cyan-300">{perMinute} {unit}</b></span>
        <span>{minutes > 60 ? `${minutes} minutes in total` : `${minutes} minute parts`}</span>
      </div>
    </div>
  )
}

function DistanceStory({ round, reduceMotion }) {
  const minutes = round.arrivalMin - round.timeNowMin
  return (
    <>
      <Step number="1" eyebrow="Turn the clocks into time" title="Count to the next whole hour, then count on to arrival" reduceMotion={reduceMotion}>
        <Journey round={round} label="arrive" reduceMotion={reduceMotion} />
        <ClockChips round={round} reduceMotion={reduceMotion} />
        <Equation answer={`${minutes} minutes`}>{clockMinuteParts(round.timeNowMin, round.arrivalMin).map(p => p.minutes).join(' + ')}</Equation>
      </Step>
      <Step number="2" eyebrow="Give every minute its distance" title={`Each one-minute part covers ${round.mpm} miles`} delay={0.1} reduceMotion={reduceMotion}>
        <MinuteStrip minutes={minutes} perMinute={round.mpm} reduceMotion={reduceMotion} />
      </Step>
      <Step number="3" eyebrow="Put all the equal parts together" title="Multiply the minutes by the miles in each minute" delay={0.2} reduceMotion={reduceMotion}>
        <Equation answer="? miles">{minutes} × {round.mpm}</Equation>
      </Step>
    </>
  )
}

function ArrivalStory({ round, reduceMotion }) {
  const minutes = round.arrivalMin - round.timeNowMin
  return (
    <>
      <Step number="1" eyebrow="Split the distance into minute-sized pieces" title={`One minute carries you ${round.mpm} miles`} reduceMotion={reduceMotion}>
        <div className="ant-distance-blocks">
          <span>{round.totalDistance}<small>miles total</small></span>
          <b>÷</b>
          <span>{round.mpm}<small>miles each minute</small></span>
        </div>
        <MinuteStrip minutes={minutes} perMinute={round.mpm} reduceMotion={reduceMotion} />
        <Equation answer={`${minutes} minutes`}>{round.totalDistance} ÷ {round.mpm}</Equation>
      </Step>
      <Step number="2" eyebrow="Move that many minutes around the clock" title="Pause at each whole hour so the clock stays easy to read" delay={0.12} reduceMotion={reduceMotion}>
        <Journey round={round} label="your answer" reduceMotion={reduceMotion} hideArrival />
        <ClockChips round={round} hideAnswer reduceMotion={reduceMotion} />
        <Equation answer="????">{formatHHMM(round.timeNowMin)} + {minutes} min</Equation>
      </Step>
    </>
  )
}

function FuelStory({ round, reduceMotion }) {
  const minutes = round.arrivalMin - round.timeNowMin
  const hourShare = minutes / 60
  const hourParts = Array.from({ length: Math.ceil(minutes / 60) }, (_, i) => Math.min(60, minutes - i * 60))
  return (
    <>
      <Step number="1" eyebrow="First find how long the journey lasts" title={`At ${round.mpm} miles each minute, split the distance into equal minutes`} reduceMotion={reduceMotion}>
        <Equation answer={`${minutes} minutes`}>{round.totalDistance} ÷ {round.mpm}</Equation>
      </Step>
      <Step number="2" eyebrow="Match minutes to the hourly fuel rate" title={`The aircraft burns ${round.gph} gallons in a full 60-minute hour`} delay={0.1} reduceMotion={reduceMotion}>
        <div className="mt-5 space-y-5">
          {hourParts.map((part, i) => (
            <div key={i}>
              <div className="ant-hour-gauge">
                <motion.div className="ant-hour-fill" initial={{ width: 0 }} animate={{ width: `${(part / 60) * 100}%` }} transition={{ duration: 0.7, delay: 0.15 + i * 0.12, ease }} />
                <div className="ant-hour-marker" style={{ left: `${(part / 60) * 100}%` }}><span>{part} min</span></div>
              </div>
              <div className="flex justify-between text-[10px] text-slate-500 mt-2"><span>Hour {i + 1}</span><span>60 min = {round.gph} gal</span></div>
            </div>
          ))}
        </div>
      </Step>
      <Step number="3" eyebrow="Use the fraction of an hour you flew" title={`${minutes} minutes is ${Number.isInteger(hourShare) ? hourShare : `${minutes}/60`} hour${hourShare === 1 ? '' : 's'}`} delay={0.2} reduceMotion={reduceMotion}>
        <Equation answer="? gallons">{round.gph} × {minutes} ÷ 60</Equation>
      </Step>
    </>
  )
}

function SpeedStory({ round, reduceMotion }) {
  const minutes = round.arrivalMin - round.timeNowMin
  const repeats = 60 / minutes
  return (
    <>
      <Step number="1" eyebrow="Turn the two clock times into journey time" title="Count to the next whole hour, then count on to arrival" reduceMotion={reduceMotion}>
        <Journey round={round} label="arrive" reduceMotion={reduceMotion} />
        <ClockChips round={round} reduceMotion={reduceMotion} />
        <Equation answer={`${minutes} minutes`}>{clockMinuteParts(round.timeNowMin, round.arrivalMin).map(p => p.minutes).join(' + ')}</Equation>
      </Step>
      <Step number="2" eyebrow="Scale that journey up to one hour" title={`Miles per hour means: how far could you go in 60 minutes?`} delay={0.1} reduceMotion={reduceMotion}>
        <div className="ant-scale-journey">
          <div><strong>{minutes} min</strong><span>{round.totalDistance} miles</span></div>
          <motion.div initial={reduceMotion ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.8, ease }} className="ant-scale-arrow">→</motion.div>
          <div className="highlight"><strong>60 min</strong><span>? miles</span></div>
        </div>
        <p className="mt-3 text-xs text-slate-400">The time grows by <b className="text-white">× {Number.isInteger(repeats) ? repeats : `60 ÷ ${minutes}`}</b>, so the distance must grow by the same amount.</p>
      </Step>
      <Step number="3" eyebrow="Calculate the one-hour distance" title="That one-hour distance is the speed in mph" delay={0.2} reduceMotion={reduceMotion}>
        <Equation answer="? mph">{round.totalDistance} × 60 ÷ {minutes}</Equation>
      </Step>
    </>
  )
}

export default function AntVisualBreakdown({ round }) {
  const reduceMotion = useReducedMotion()
  const stories = { arrival: ArrivalStory, distance: DistanceStory, fuel: FuelStory, speed: SpeedStory }
  const Story = stories[round.type]
  return (
    <div className="ant-logic-breakdown" data-testid={`ant-breakdown-${round.type}`}>
      <div className="flex items-start gap-3 mb-4">
        <div className="ant-logic-bulb" aria-hidden="true">✦</div>
        <div>
          <p className="text-sm font-extrabold text-white">Let’s make the journey visible</p>
          <p className="text-xs text-slate-400 mt-0.5">Follow the pictures one step at a time. Your answer is still yours to enter.</p>
        </div>
      </div>
      <div className="space-y-3"><Story round={round} reduceMotion={reduceMotion} /></div>
    </div>
  )
}
