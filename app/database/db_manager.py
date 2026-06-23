import logging
import json
from typing import List, Dict, Any, Optional
from datetime import datetime
from threading import Lock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from app.config import DATABASE_URI
from app.database.models import Base, User, TrainingSession, DialogueDetail, PsychologicalScore

logger = logging.getLogger(__name__)

class DatabaseManager:
    """数据库管理类，提供数据库连接和基础 CRUD 操作"""
    
    def __init__(self, db_uri: str = DATABASE_URI):
        """
        初始化数据库引擎与会话工厂
        """
        # 如果是 SQLite，需要设置 check_same_thread 为 False
        connect_args = {"check_same_thread": False} if db_uri.startswith("sqlite") else {}
        
        self.engine = create_engine(
            db_uri,
            connect_args=connect_args,
            echo=False
        )
        self.SessionLocal = sessionmaker(
            autocommit=False,
            autoflush=False,
            expire_on_commit=False,
            bind=self.engine,
        )
        self._initialized = False
        self._init_lock = Lock()
        
    def init_db(self) -> None:
        """初始化数据库，创建所有定义在 models 中的表"""
        if self._initialized:
            return
        try:
            with self._init_lock:
                if self._initialized:
                    return
                Base.metadata.create_all(bind=self.engine)
                self._initialized = True
                logger.info("数据库初始化成功，所有表已准备就绪。")
        except Exception as e:
            logger.error(f"数据库初始化失败: {e}")
            raise
            
    def get_session(self) -> Session:
        """获取并返回一个数据库会话实例"""
        return self.SessionLocal()

    def get_or_create_user(self, username: str) -> User:
        """
        根据用户名获取用户，如果不存在则创建
        """
        with self.get_session() as session:
            user = session.query(User).filter(User.username == username).first()
            if not user:
                user = User(username=username)
                session.add(user)
                session.commit()
                session.refresh(user)
            return user

    def create_session(
        self,
        user_id: int,
        topic: str = "默认培训主题",
        scene_type: Optional[str] = None,
        difficulty: Optional[str] = None,
    ) -> TrainingSession:
        """
        创建一个新的培训会话
        """
        with self.get_session() as session:
            new_session = TrainingSession(
                user_id=user_id,
                topic=topic,
                scene_type=scene_type,
                difficulty=difficulty,
            )
            session.add(new_session)
            session.commit()
            session.refresh(new_session)
            return new_session
            
    def end_session(
        self,
        session_id: int,
        identified_fraud: Optional[bool] = None,
        pdf_report_path: Optional[str] = None,
    ) -> None:
        """
        结束指定的培训会话，记录结束时间
        """
        with self.get_session() as session:
            db_session = session.query(TrainingSession).filter(TrainingSession.id == session_id).first()
            if db_session:
                db_session.end_time = datetime.now()
                if identified_fraud is not None:
                    db_session.identified_fraud = identified_fraud
                if pdf_report_path is not None:
                    db_session.pdf_report_path = pdf_report_path
                session.commit()
                
    def add_dialogue_turn(self, session_id: int, speaker: str, content: str, round_number: int = 0) -> DialogueDetail:
        """
        添加一条对话详情记录
        """
        with self.get_session() as session:
            dialogue = DialogueDetail(
                session_id=session_id,
                round_number=round_number,
                speaker=speaker,
                content=content
            )
            session.add(dialogue)
            db_session = session.query(TrainingSession).filter(TrainingSession.id == session_id).first()
            if db_session and round_number > (db_session.total_rounds or 0):
                db_session.total_rounds = round_number
            session.commit()
            session.refresh(dialogue)
            return dialogue
            
    def save_psychological_score(
        self,
        session_id: int,
        round_number: int,
        scores: Dict[str, float],
        composite_score: float,
        activated_dimensions: List[Dict[str, Any]],
        feedback: str = "",
    ) -> PsychologicalScore:
        """
        保存心理评分和反馈记录
        """
        with self.get_session() as session:
            score = PsychologicalScore(
                session_id=session_id,
                round_number=round_number,
                e01_score=scores.get("E-01", 0.0),
                e02_score=scores.get("E-02", 0.0),
                e03_score=scores.get("E-03", 0.0),
                l01_score=scores.get("L-01", 0.0),
                l02_score=scores.get("L-02", 0.0),
                l03_score=scores.get("L-03", 0.0),
                c01_score=scores.get("C-01", 0.0),
                c02_score=scores.get("C-02", 0.0),
                c03_score=scores.get("C-03", 0.0),
                s01_score=scores.get("S-01", 0.0),
                s02_score=scores.get("S-02", 0.0),
                s03_score=scores.get("S-03", 0.0),
                composite_score=composite_score,
                activated_dimensions=json.dumps(activated_dimensions, ensure_ascii=False),
                feedback_notes=feedback
            )
            session.add(score)
            session.commit()
            session.refresh(score)
            return score
            
    def get_session_history(self, session_id: int) -> List[Dict[str, Any]]:
        """
        获取特定会话的所有对话记录，按时间顺序排列
        """
        with self.get_session() as session:
            dialogues = session.query(DialogueDetail).filter(
                DialogueDetail.session_id == session_id
            ).order_by(DialogueDetail.timestamp).all()
            
            return [
                {
                    "speaker": d.speaker, 
                    "role": "user" if d.speaker == "user" else "assistant",
                    "content": d.content, 
                    "round_number": d.round_number,
                    "timestamp": d.timestamp
                } for d in dialogues
            ]

# 提供一个全局的数据库管理实例供外部直接导入使用
db = DatabaseManager()
